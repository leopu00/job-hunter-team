"""Only the fixed host bridge, with synthetic metadata and inert local children."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'desktop/src-tauri/src/closer_desktop_bridge.py'
spec = importlib.util.spec_from_file_location('bridge281', SOURCE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.pin = dict(container_id='c'*64, image_id='sha256:'+'d'*64,
                        oci_revision=bridge.REVISION, digest=bridge.DIGEST)
        self.container = dict(Id=self.pin['container_id'], Image=self.pin['image_id'],
                              Revision=bridge.REVISION, Running=True)
        self.image = dict(Id=self.pin['image_id'], Revision=bridge.REVISION, OS='linux', Arch='amd64',
                          Digests=['example.invalid/synthetic@'+bridge.DIGEST])
    def invoke(self, values):
        with patch.object(bridge, 'run', side_effect=values) as run:
            result = bridge.bridge(dict(runtime=self.pin, request={'op':'descriptor'}))
            return result, run.call_args_list
    def test_exact_cid_platform_and_uid_then_fixed_entry_stdin(self):
        result, calls = self.invoke([self.container, self.image, self.image, {'ok':True,'phase':'absent'}])
        self.assertEqual(result, {'ok':True,'phase':'absent'})
        self.assertEqual(len(calls), 4)
        self.assertIn('--platform', calls[2].args[0])
        self.assertIn('linux/amd64', calls[2].args[0])
        argv, payload, cap, _ = calls[3].args
        self.assertEqual(argv[:6], ['docker','exec','--user','1001','-i',self.pin['container_id']])
        self.assertEqual(argv[6:], ['/usr/bin/python3','-I','-B','-c',bridge.ENTRY])
        self.assertEqual(json.loads(payload), {'op':'descriptor'})
        self.assertEqual(cap, 12*1024*1024)
    def test_mismatch_never_executes(self):
        for key, value in [('Id','jht'), ('Image','sha256:'+'0'*64), ('Revision','0'*40), ('Running',False)]:
            with self.subTest(key=key), patch.object(bridge,'run',return_value={**self.container,key:value}) as run:
                with self.assertRaises(ValueError): bridge.bridge(dict(runtime=self.pin,request={'op':'descriptor'}))
                self.assertEqual(run.call_count,1)
        for index in [1,2]:
            for key,value in [('Id','registry-config-not-image'), ('OS','windows'), ('Arch','arm64'),
                              ('Revision','0'*40), ('Digests',['example.invalid/other@sha256:'+'0'*64])]:
                values=[self.container,self.image,self.image];values[index]={**self.image,key:value}
                with self.subTest(index=index,key=key), patch.object(bridge,'run',side_effect=values) as run:
                    with self.assertRaises(ValueError):bridge.bridge(dict(runtime=self.pin,request={'op':'descriptor'}))
                    self.assertEqual(run.call_count,index+1)
    def test_pins_not_an_alias_or_other_release(self):
        for key,value in [('container_id','jht'),('oci_revision','0'*40),('digest','sha256:'+'0'*64)]:
            with patch.object(bridge,'run') as run:
                with self.assertRaises(ValueError):bridge.bridge(dict(runtime={**self.pin,key:value},request={'op':'descriptor'}))
                run.assert_not_called()
    def test_real_owned_child_overflow_cleanup(self):
        with self.assertRaisesRegex(ValueError,'browser_response_too_large'):
            bridge.run([sys.executable,'-I','-c','print("x"*2048)'],None,32,time.monotonic()+2)
    def test_real_owned_child_timeout_cleanup(self):
        before=time.monotonic()
        with self.assertRaisesRegex(ValueError,'browser_transport_timeout'):
            bridge.run([sys.executable,'-I','-c','import time;time.sleep(10)'],None,4096,time.monotonic()+.05)
        self.assertLess(time.monotonic()-before,2)
    def test_complete_json_and_process_failure(self):
        self.assertEqual(bridge.run([sys.executable,'-I','-c','print("{\\\"ok\\\":true}")'],None,4096,time.monotonic()+2),{'ok':True})
        with self.assertRaisesRegex(ValueError,'browser_transport_unavailable'):
            bridge.run([sys.executable,'-I','-c','import sys;sys.stderr.write("secret");sys.exit(1)'],None,4096,time.monotonic()+2)
    def test_source_bound_and_small(self):
        self.assertLessEqual(len(SOURCE.read_bytes()),5120)
        self.assertNotIn('shell=True',SOURCE.read_text())

if __name__ == '__main__':unittest.main()
