use std::path::PathBuf;

use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::WindowBuilder;
use tao::dpi::LogicalSize;
use wry::WebViewBuilder;

use crate::config::{self, SetupConfig};
use crate::bootstrap;

#[derive(Clone)]
enum AppState {
    Wizard,
    Bootstrapping,
    Running(u16),
    Error(String),
}

// Custom event to update webview from bootstrap thread
#[derive(Debug)]
enum UserEvent {
    BootstrapProgress(u8, String),
    BootstrapDone(u16),
    BootstrapError(String),
    EvalJs(String),
}

pub fn run(existing: Option<SetupConfig>) {
    let default_dir = existing
        .as_ref()
        .map(|c| c.work_dir.display().to_string())
        .unwrap_or_else(|| config::default_workspace().display().to_string());
    let default_provider = existing
        .as_ref()
        .map(|c| c.provider.clone())
        .unwrap_or_default();
    let default_key = existing
        .as_ref()
        .map(|c| c.api_key.clone())
        .unwrap_or_default();

    let html = build_html(&default_dir, &default_provider, &default_key);

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let window = WindowBuilder::new()
        .with_title("JHT Desktop")
        .with_inner_size(LogicalSize::new(500.0, 520.0))
        .with_resizable(false)
        .build(&event_loop)
        .unwrap();

    let proxy_ipc = proxy.clone();
    let proxy_browse = proxy.clone();

    let webview = WebViewBuilder::new()
        .with_html(&html)
        .with_ipc_handler(move |msg| {
            let body = msg.body();
            if body == "browse" {
                let proxy_b = proxy_browse.clone();
                std::thread::spawn(move || {
                    if let Some(path) = pick_folder() {
                        let escaped = path.replace('\\', "\\\\").replace('\'', "\\'");
                        let js = format!(
                            "document.getElementById('workDir').value='{}'",
                            escaped
                        );
                        let _ = proxy_b.send_event(UserEvent::EvalJs(js));
                    }
                });
            } else if body.starts_with("submit:") {
                let json = &body[7..];
                if let Some(cfg) = parse_submit(json) {
                    let _ = config::save_config(&cfg);
                    let proxy2 = proxy_ipc.clone();

                    std::thread::spawn(move || {
                        run_bootstrap_with_events(&cfg, proxy2);
                    });
                }
            } else if body.starts_with("open:") {
                let url = &body[5..];
                let _ = open::that(url);
            } else if body == "quit" {
                std::process::exit(0);
            }
        })
        .build(&window)
        .unwrap();

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::UserEvent(ue) => {
                match ue {
                    UserEvent::BootstrapProgress(step, msg) => {
                        let js = format!(
                            "updateProgress({}, '{}')",
                            step,
                            msg.replace('\'', "\\'")
                        );
                        let _ = webview.evaluate_script(&js);
                    }
                    UserEvent::BootstrapDone(port) => {
                        let js = format!("showRunning({})", port);
                        let _ = webview.evaluate_script(&js);
                    }
                    UserEvent::BootstrapError(err) => {
                        let js = format!(
                            "showError('{}')",
                            err.replace('\'', "\\'").replace('\n', "\\n")
                        );
                        let _ = webview.evaluate_script(&js);
                    }
                    UserEvent::EvalJs(js) => {
                        let _ = webview.evaluate_script(&js);
                    }
                }
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });
}

fn run_bootstrap_with_events(cfg: &SetupConfig, proxy: tao::event_loop::EventLoopProxy<UserEvent>) {
    let send = |step: u8, msg: &str| {
        let _ = proxy.send_event(UserEvent::BootstrapProgress(step, msg.to_string()));
        std::thread::sleep(std::time::Duration::from_millis(100));
    };

    macro_rules! step {
        ($n:expr, $msg:expr, $body:expr) => {{
            send($n, $msg);
            match (|| -> Result<(), String> { $body })() {
                Ok(()) => {}
                Err(e) => {
                    let _ = proxy.send_event(UserEvent::BootstrapError(e));
                    return;
                }
            }
        }};
    }

    // Step 1: Check prerequisites
    step!(1, "Checking system requirements...", {
        bootstrap::check_prerequisites()
    });

    // Step 2: Check tmux
    step!(2, "Checking tmux...", {
        bootstrap::ensure_tmux()
    });

    // Step 3: Check Node.js
    step!(3, "Checking Node.js...", {
        bootstrap::ensure_node()
    });

    // Step 4: Check AI CLI
    let cli_name = match cfg.provider.as_str() {
        "anthropic" => "claude",
        "kimi" => "kimik2",
        "openai" => "codex",
        _ => "claude",
    };
    step!(4, &format!("Checking {} CLI...", cli_name), {
        bootstrap::check_ai_cli(cfg)
    });

    // Step 5: Clone/update repo
    step!(5, "Updating repository...", {
        bootstrap::ensure_repo()
    });

    // Step 6: Install deps
    step!(6, "Installing dependencies...", {
        bootstrap::ensure_deps()
    });

    // Step 7: Setup workspace
    step!(7, "Setting up workspace...", {
        bootstrap::setup_workspace(cfg)
    });

    // Step 8: Start web server
    send(8, "Starting web server...");
    let port = match bootstrap::start_web_server() {
        Ok(p) => p,
        Err(e) => {
            let _ = proxy.send_event(UserEvent::BootstrapError(e));
            return;
        }
    };

    // Step 9: Start team
    step!(9, "Starting agent team...", {
        bootstrap::start_team(cfg)
    });

    // Step 10: Open browser
    send(10, "Opening browser...");
    let url = format!("http://localhost:{}", port);
    let _ = open::that(&url);

    let _ = proxy.send_event(UserEvent::BootstrapDone(port));
}

#[cfg(windows)]
fn pick_folder() -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let script = r#"
        Add-Type -AssemblyName Microsoft.VisualBasic
        $app = New-Object -ComObject Shell.Application
        $folder = $app.BrowseForFolder(0, 'Select working directory', 0x40 + 0x10, 0)
        if ($folder) { Write-Output $folder.Self.Path }
    "#;
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() { None } else { Some(path) }
}

#[cfg(target_os = "macos")]
fn pick_folder() -> Option<String> {
    let script = "POSIX path of (choose folder with prompt \"Select working directory\")";
    let output = std::process::Command::new("osascript")
        .args(["-e", script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_end_matches('/')
        .to_string();
    if path.is_empty() { None } else { Some(path) }
}

fn parse_submit(json: &str) -> Option<SetupConfig> {
    let work_dir = extract_json_val(json, "work_dir")?;
    let provider = extract_json_val(json, "provider")?;
    let auth_method = extract_json_val(json, "auth_method").unwrap_or_else(|| "api-key".to_string());
    let api_key = extract_json_val(json, "api_key").unwrap_or_default();

    Some(SetupConfig {
        work_dir: PathBuf::from(work_dir),
        provider,
        auth_method,
        api_key,
    })
}

fn extract_json_val(json: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{}\"", key);
    let idx = json.find(&pattern)?;
    let rest = &json[idx + pattern.len()..];
    let colon = rest.find(':')?;
    let rest = &rest[colon + 1..];
    let quote_start = rest.find('"')?;
    let rest = &rest[quote_start + 1..];
    let quote_end = rest.find('"')?;
    Some(rest[..quote_end].replace("\\\\", "\\"))
}

fn build_html(default_dir: &str, default_provider: &str, default_key: &str) -> String {
    let escaped_dir = default_dir.replace('\\', "\\\\");
    let escaped_key = default_key.replace('\\', "\\\\");

    format!(r##"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
  font-family: 'Segoe UI', system-ui, sans-serif;
  background: #0d1411;
  color: #e0e0e0;
  height: 100vh;
  overflow: hidden;
}}
.page {{ display: none; height: 100vh; flex-direction: column; }}
.page.active {{ display: flex; }}

/* ── Header ── */
.header {{ padding: 24px 36px 0; }}
.header h1 {{ color: #44cc66; font-size: 20px; font-weight: 700; margin-bottom: 4px; }}
.header .sub {{ color: #555; font-size: 11px; }}

/* ── Steps dots ── */
.steps {{ display: flex; gap: 6px; padding: 14px 36px 0; }}
.step-dot {{ width: 28px; height: 3px; background: #1a2420; transition: background 0.3s; }}
.step-dot.active {{ background: #44cc66; }}
.step-dot.done {{ background: #2a5a3a; }}

/* ── Content ── */
.content {{ flex: 1; padding: 24px 36px; overflow-y: auto; }}
.step {{ display: none; flex-direction: column; }}
.step.active {{ display: flex; }}
label {{ color: #888; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 8px; display: block; }}
.field {{ margin-bottom: 20px; }}
input, select {{
  width: 100%; background: #1a2420; border: 1px solid #2a3a32; color: #e0e0e0;
  padding: 10px 12px; font-size: 13px; font-family: inherit; outline: none;
  transition: border-color 0.2s;
}}
input:focus, select:focus {{ border-color: #44cc66; }}
input::placeholder {{ color: #444; }}
select option {{ background: #1a2420; color: #e0e0e0; }}
.hint {{ color: #444; font-size: 10px; margin-top: 5px; }}
.error {{ color: #cc4444; font-size: 11px; margin-top: 6px; }}

/* ── Provider cards ── */
.pcard {{
  display: flex; align-items: center; gap: 12px; padding: 12px 14px;
  background: #1a2420; border: 1px solid #2a3a32; cursor: pointer;
  transition: all 0.2s; margin-bottom: 8px;
}}
.pcard:hover {{ border-color: #3a5a42; }}
.pcard.sel {{ border-color: #44cc66; background: #162820; }}
.pcard .nm {{ font-size: 13px; font-weight: 600; }}
.pcard .ds {{ font-size: 10px; color: #666; margin-top: 2px; }}
.pcard .dt {{
  width: 10px; height: 10px; border: 1px solid #3a5a42;
  border-radius: 50%; flex-shrink: 0; transition: all 0.2s;
}}
.pcard.sel .dt {{ background: #44cc66; border-color: #44cc66; }}

/* ── Footer ── */
.footer {{ padding: 0 36px 20px; display: flex; gap: 10px; justify-content: flex-end; }}
.btn {{
  padding: 10px 28px; font-size: 12px; font-weight: 700; cursor: pointer;
  border: 1px solid; font-family: inherit; letter-spacing: 0.3px; transition: all 0.2s;
}}
.btn-back {{ background: transparent; border-color: #2a3a32; color: #888; }}
.btn-back:hover {{ border-color: #44cc66; color: #e0e0e0; }}
.btn-next {{ background: transparent; border-color: #44cc66; color: #44cc66; }}
.btn-next:hover {{ background: #44cc66; color: #0d1411; }}

/* ── Progress page ── */
.progress-wrap {{ flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 40px; }}
.progress-title {{ color: #44cc66; font-size: 18px; font-weight: 700; margin-bottom: 24px; text-align: center; }}
.progress-status {{ color: #aaa; font-size: 12px; text-align: center; margin-bottom: 16px; min-height: 18px; }}
.bar-bg {{ background: #1a2420; height: 6px; width: 100%; margin-bottom: 8px; }}
.bar-fill {{ background: #44cc66; height: 6px; width: 0%; transition: width 0.4s ease; }}
.bar-label {{ color: #555; font-size: 10px; text-align: center; }}

/* ── Running page ── */
.running-wrap {{ flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 40px; }}
.running-icon {{ font-size: 48px; margin-bottom: 16px; }}
.running-title {{ color: #44cc66; font-size: 20px; font-weight: 700; margin-bottom: 8px; }}
.running-url {{ color: #888; font-size: 13px; margin-bottom: 24px; }}
.running-url a {{ color: #44cc66; text-decoration: none; }}
.running-url a:hover {{ text-decoration: underline; }}
.running-hint {{ color: #444; font-size: 10px; margin-top: 16px; }}
.btn-open {{ background: transparent; border: 1px solid #44cc66; color: #44cc66; padding: 10px 32px;
  font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s; font-family: inherit; }}
.btn-open:hover {{ background: #44cc66; color: #0d1411; }}

/* ── Error page ── */
.error-wrap {{ flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 40px; }}
.error-title {{ color: #cc4444; font-size: 18px; font-weight: 700; margin-bottom: 12px; }}
.error-msg {{ color: #aaa; font-size: 12px; line-height: 1.6; white-space: pre-wrap; margin-bottom: 20px;
  background: #1a1a1a; padding: 12px; border: 1px solid #332222; }}
.btn-retry {{ background: transparent; border: 1px solid #cc4444; color: #cc4444; padding: 8px 24px;
  font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; }}
</style>
</head>
<body>

<!-- PAGE: WIZARD -->
<div class="page active" id="page-wizard">
  <div class="header"><h1>JHT Desktop</h1><p class="sub">Job Hunter Team — Setup</p></div>
  <div class="steps" id="stepDots"></div>
  <div class="content">
    <div class="step active" id="wiz-0">
      <div class="field">
        <label>Working directory</label>
        <div style="display:flex;gap:8px">
          <input type="text" id="workDir" value="{escaped_dir}" placeholder="C:\Users\you\JHT" style="flex:1" />
          <button onclick="window.ipc.postMessage('browse')" style="background:#1a2420;border:1px solid #2a3a32;color:#44cc66;padding:8px 14px;cursor:pointer;font-size:16px;transition:all 0.2s;flex-shrink:0" onmouseover="this.style.borderColor='#44cc66'" onmouseout="this.style.borderColor='#2a3a32'">&#128193;</button>
        </div>
        <div class="hint">Where your job search data will be stored</div>
      </div>
    </div>
    <div class="step" id="wiz-1">
      <div class="field"><label>AI Provider</label>
        <div class="pcard" data-v="anthropic" onclick="sp(this)"><div class="dt"></div><div><div class="nm">Anthropic</div><div class="ds">Claude via Messages API</div></div></div>
        <div class="pcard" data-v="openai" onclick="sp(this)"><div class="dt"></div><div><div class="nm">OpenAI</div><div class="ds">Codex OAuth + API key</div></div></div>
        <div class="pcard" data-v="kimi" onclick="sp(this)"><div class="dt"></div><div><div class="nm">Moonshot AI</div><div class="ds">Kimi K2.5</div></div></div>
      </div>
    </div>
    <div class="step" id="wiz-2">
      <div class="field"><label>Authentication method</label><div id="authList"></div></div>
    </div>
    <div class="step" id="wiz-3">
      <div class="field">
        <label id="credL">API Key</label>
        <input type="password" id="apiKey" value="{escaped_key}" placeholder="" />
        <div class="hint" id="credH">Your key is stored locally and never shared</div>
        <div class="error" id="credE"></div>
      </div>
    </div>
  </div>
  <div class="footer">
    <button class="btn btn-back" id="btnB" onclick="back()" style="display:none">Back</button>
    <button class="btn btn-next" id="btnN" onclick="next()">Next</button>
  </div>
</div>

<!-- PAGE: PROGRESS -->
<div class="page" id="page-progress">
  <div class="progress-wrap">
    <div class="progress-title">Setting up JHT...</div>
    <div class="progress-status" id="progMsg">Initializing...</div>
    <div class="bar-bg"><div class="bar-fill" id="progBar"></div></div>
    <div class="bar-label" id="progLabel">0/10</div>
  </div>
</div>

<!-- PAGE: RUNNING -->
<div class="page" id="page-running">
  <div class="running-wrap">
    <div class="running-title">JHT is running</div>
    <div class="running-url" id="runUrl"></div>
    <button class="btn-open" onclick="window.ipc.postMessage('open:' + runPort)">Open Dashboard</button>
    <div class="running-hint">Close this window to keep JHT running in background</div>
  </div>
</div>

<!-- PAGE: ERROR -->
<div class="page" id="page-error">
  <div class="error-wrap">
    <div class="error-title">Setup failed</div>
    <div class="error-msg" id="errMsg"></div>
    <button class="btn-retry" onclick="location.reload()">Retry</button>
  </div>
</div>

<script>
let cs=0, prov='{default_provider}'||'', authM='', runPort=3000;
const PH={{anthropic:'sk-ant-api03-...',openai:'sk-proj-...',kimi:'sk-...'}};
const AM={{
  anthropic:[{{id:'api-key',label:'API Key',hint:'sk-ant-...',kind:'apiKey'}}],
  openai:[{{id:'oauth',label:'OAuth (Codex)',hint:'Browser login',kind:'oauth'}},{{id:'api-key',label:'API Key',hint:'sk-...',kind:'apiKey'}}],
  kimi:[{{id:'api-key',label:'API Key',hint:'sk-...',kind:'apiKey'}}],
}};

function init(){{ if(prov)spv(prov); dots(); show(0); }}
function dots(){{
  const e=document.getElementById('stepDots'); e.innerHTML='';
  for(let i=0;i<4;i++){{ const d=document.createElement('div'); d.className='step-dot'+(i<cs?' done':'')+(i===cs?' active':''); e.appendChild(d); }}
}}
function show(n){{
  cs=n; document.querySelectorAll('.step').forEach((e,i)=>e.classList.toggle('active',i===n));
  document.getElementById('btnB').style.display=n>0?'':'none';
  document.getElementById('btnN').textContent=n===3?'Start JHT':'Next';
  if(n===2){{ const m=AM[prov]||[]; if(m.length<=1){{ authM=m[0]?.id||'api-key'; show(3); setupCred(); return; }} renderAM(); }}
  if(n===3) setupCred();
  dots();
}}
function sp(el){{ document.querySelectorAll('.pcard').forEach(c=>c.classList.remove('sel')); el.classList.add('sel'); prov=el.dataset.v; }}
function spv(v){{ const c=document.querySelector('.pcard[data-v="'+v+'"]'); if(c)sp(c); }}
function renderAM(){{
  const l=document.getElementById('authList'); l.innerHTML='';
  (AM[prov]||[]).forEach(m=>{{
    const d=document.createElement('div'); d.className='pcard'+(authM===m.id?' sel':''); d.dataset.v=m.id;
    d.onclick=function(){{ document.querySelectorAll('#authList .pcard').forEach(c=>c.classList.remove('sel')); this.classList.add('sel'); authM=this.dataset.v; }};
    d.innerHTML='<div class="dt"></div><div><div class="nm">'+m.label+'</div><div class="ds">'+(m.hint||'')+'</div></div>';
    l.appendChild(d);
  }});
}}
function setupCred(){{
  const m=(AM[prov]||[]).find(x=>x.id===authM);
  if(m&&m.kind==='oauth'){{ document.getElementById('credL').textContent='OAuth'; document.getElementById('apiKey').style.display='none'; document.getElementById('credH').textContent='Click Start to open browser'; }}
  else{{ document.getElementById('credL').textContent='API Key'; document.getElementById('apiKey').style.display=''; document.getElementById('apiKey').placeholder=PH[prov]||'sk-...'; document.getElementById('credH').textContent='Your key is stored locally and never shared'; }}
  document.getElementById('credE').textContent='';
}}
function back(){{ if(cs<=0)return; let p=cs-1; if(p===2&&(AM[prov]||[]).length<=1)p=1; show(p); }}
function next(){{
  const e=document.getElementById('credE'); if(e)e.textContent='';
  if(cs===0){{ if(!document.getElementById('workDir').value.trim())return; show(1); }}
  else if(cs===1){{ if(!prov)return; show(2); }}
  else if(cs===2){{ if(!authM)return; show(3); }}
  else if(cs===3){{
    const k=document.getElementById('apiKey').value.trim();
    const m=(AM[prov]||[]).find(x=>x.id===authM);
    if(m&&m.kind!=='oauth'&&!k){{ document.getElementById('credE').textContent='Please enter your API key'; return; }}
    if(prov==='anthropic'&&k&&!k.startsWith('sk-ant-')){{ document.getElementById('credE').textContent='Must start with sk-ant-'; return; }}
    submit(k);
  }}
}}
function submit(key){{
  const d={{work_dir:document.getElementById('workDir').value.trim(),provider:prov,auth_method:authM||'api-key',api_key:key}};
  window.ipc.postMessage('submit:'+JSON.stringify(d));
  showPage('page-progress');
}}
function showPage(id){{ document.querySelectorAll('.page').forEach(p=>p.classList.remove('active')); document.getElementById(id).classList.add('active'); }}

// Called from Rust
function updateProgress(step, msg){{
  document.getElementById('progMsg').textContent=msg;
  document.getElementById('progBar').style.width=(step*10)+'%';
  document.getElementById('progLabel').textContent=step+'/10';
}}
function showRunning(port){{
  runPort=port;
  document.getElementById('runUrl').innerHTML='Dashboard: <a href="#" onclick="window.ipc.postMessage(\'open:http://localhost:'+port+'\')">http://localhost:'+port+'</a>';
  showPage('page-running');
}}
function showError(msg){{
  document.getElementById('errMsg').textContent=msg;
  showPage('page-error');
}}

document.addEventListener('keydown',e=>{{ if(e.key==='Enter')next(); if(e.key==='Escape')back(); }});
init();
</script>
</body>
</html>"##)
}
