import json,os,re,selectors,subprocess,sys,time
LIMIT = 12 * 1024 * 1024
FAILED = "browser_transport_unavailable"
REVISION = "a0936ded520cc7c21cc3c1e136ca95b1080274f5"
DIGEST = "sha256:003557e92e857b3219471d210d582a02d4bdb7cbe65cc34b94cf966986f6a8a4"
ENTRY = ('import sys,json;sys.path.insert(0,"/app/shared/skills");'
         'from closer_interactive import desktop_request;'
         'print(json.dumps(desktop_request(json.load(sys.stdin))))')

def run(argv, payload, cap, end):
    child = None
    try:
        child = subprocess.Popen(argv, stdin=subprocess.PIPE if payload else subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if payload:
            child.stdin.write(payload)
            child.stdin.close()
        os.set_blocking(child.stdout.fileno(), False)
        data = bytearray()
        with selectors.DefaultSelector() as sel:
            sel.register(child.stdout, selectors.EVENT_READ)
            while True:
                left = end - time.monotonic()
                if left <= 0:
                    raise ValueError("browser_transport_timeout")
                if not sel.select(min(left, .05)):
                    continue
                part = os.read(child.stdout.fileno(), 65536)
                if not part:
                    break
                if len(data) + len(part) > cap:
                    raise ValueError("browser_response_too_large")
                data.extend(part)
        if child.wait(timeout=max(.001, end - time.monotonic())) != 0:
            raise ValueError(FAILED)
        return json.loads(data)
    finally:
        if child is not None:
            primary, failed = sys.exc_info()[0], False
            steps = [lambda: child.kill() if child.poll() is None else None, lambda: child.wait(timeout=1)]
            steps += [s.close for s in (child.stdin, child.stdout) if s is not None]
            for step in steps:
                try: step()
                except Exception: failed = True
            if failed and not primary:
                raise ValueError(FAILED)

def bridge(e):
    if type(e) is not dict or set(e) != {"runtime", "request"}:
        raise ValueError("browser_request_invalid")
    pin, req = e["runtime"], e["request"]
    shapes = {"container_id": r"[0-9a-f]{64}", "image_id": r"sha256:[0-9a-f]{64}"}
    if (type(pin) is not dict or set(pin) != set(shapes) | {"oci_revision", "digest"} or
            any(type(pin[k]) is not str or not re.fullmatch(shapes[k], pin[k]) for k in shapes) or
            pin["oci_revision"] != REVISION or pin["digest"] != DIGEST):
        raise ValueError("browser_binding_invalid")
    if type(req) is not dict:
        raise ValueError("browser_request_invalid")
    end = time.monotonic() + 12
    cid, iid, rev = pin["container_id"], pin["image_id"], pin["oci_revision"]
    label = '"Rev":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}'
    fmt = ('{"Id":{{json .Id}},"Run":{{json .State.Running}},"Image":{{json .Image}},'
           '"Manifest":{{json .ImageManifestDescriptor.Digest}},') + label
    info = run(["docker", "inspect", "--type", "container", "--format", fmt, cid], None, 4096, end)
    if (info.get("Id") != cid or info.get("Image") != iid or
            info.get("Rev") != rev or info.get("Run") is not True or
            not re.fullmatch(shapes["image_id"], info.get("Manifest") or "")):
        raise ValueError("browser_container_mismatch")
    fmt = ('{"Id":{{json .Id}},"OS":{{json .Os}},"Arch":{{json .Architecture}},'
           '"Repos":{{json .RepoDigests}},') + label
    for platform in ([], ["--platform", "linux/amd64"]):
        image = run(["docker", "image", "inspect", *platform, "--format", fmt, iid], None, 8192, end)
        expected = info["Manifest"] if platform else iid
        if (image.get("Id") != expected or image.get("Rev") != rev or
                image.get("OS") != "linux" or image.get("Arch") != "amd64" or
                type(image.get("Repos")) is not list or
                not any(type(d) is str and d.endswith("@" + pin["digest"]) for d in image["Repos"])):
            raise ValueError("browser_image_mismatch")
    reply = run(["docker", "exec", "--user", "1001", "-i", cid,
                 "/usr/bin/python3", "-I", "-B", "-c", ENTRY],
                json.dumps(req).encode(), LIMIT, end)
    if type(reply) is not dict:
        raise ValueError("browser_response_invalid")
    return reply

def main():
    try:
        raw = sys.stdin.buffer.read(2049)
        if len(raw) > 2048:
            raise ValueError("browser_request_invalid")
        result = bridge(json.loads(raw))
    except Exception as error:
        code = str(error)
        codes = {"browser_" + c for c in ("request_invalid", "binding_invalid", "container_mismatch",
                 "image_mismatch", "transport_timeout", "transport_unavailable", "response_too_large", "response_invalid")}
        result = {"ok": False, "error": code if code in codes else FAILED}
    print(json.dumps(result, separators=(",", ":")))

if __name__ == "__main__":
    main()
