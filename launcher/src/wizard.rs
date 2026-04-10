use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::WindowBuilder;
use tao::dpi::LogicalSize;
use wry::WebViewBuilder;

use crate::config::SetupConfig;

const WIZARD_HTML: &str = r##"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: #0d1411;
    color: #e0e0e0;
    min-height: 100vh;
    overflow: hidden;
  }
  .wizard { display: flex; flex-direction: column; height: 100vh; }
  .header {
    padding: 28px 36px 0;
  }
  .header h1 {
    color: #44cc66;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.5px;
    margin-bottom: 4px;
  }
  .header .sub { color: #666; font-size: 11px; }
  .steps {
    display: flex;
    gap: 6px;
    padding: 16px 36px 0;
  }
  .step-dot {
    width: 32px; height: 3px;
    background: #1a2420;
    transition: background 0.3s;
  }
  .step-dot.active { background: #44cc66; }
  .step-dot.done { background: #2a5a3a; }
  .content {
    flex: 1;
    padding: 24px 36px;
    display: flex;
    flex-direction: column;
  }
  .step { display: none; flex-direction: column; flex: 1; }
  .step.active { display: flex; }
  label {
    color: #888;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    margin-bottom: 8px;
  }
  .field { margin-bottom: 20px; }
  input, select {
    width: 100%;
    background: #1a2420;
    border: 1px solid #2a3a32;
    color: #e0e0e0;
    padding: 10px 12px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s;
  }
  input:focus, select:focus { border-color: #44cc66; }
  input::placeholder { color: #444; }
  select { cursor: pointer; }
  select option { background: #1a2420; color: #e0e0e0; }
  .hint { color: #444; font-size: 10px; margin-top: 5px; }
  .provider-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: #1a2420;
    border: 1px solid #2a3a32;
    cursor: pointer;
    transition: all 0.2s;
    margin-bottom: 8px;
  }
  .provider-card:hover { border-color: #3a5a42; }
  .provider-card.selected { border-color: #44cc66; background: #162820; }
  .provider-card .name { font-size: 13px; font-weight: 600; color: #e0e0e0; }
  .provider-card .desc { font-size: 10px; color: #666; margin-top: 2px; }
  .provider-card .dot {
    width: 10px; height: 10px;
    border: 1px solid #3a5a42;
    border-radius: 50%;
    flex-shrink: 0;
    transition: all 0.2s;
  }
  .provider-card.selected .dot {
    background: #44cc66;
    border-color: #44cc66;
  }
  .footer {
    padding: 0 36px 24px;
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }
  .btn {
    padding: 10px 28px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    border: 1px solid;
    font-family: inherit;
    letter-spacing: 0.3px;
    transition: all 0.2s;
  }
  .btn-back {
    background: transparent;
    border-color: #2a3a32;
    color: #888;
  }
  .btn-back:hover { border-color: #44cc66; color: #e0e0e0; }
  .btn-next {
    background: transparent;
    border-color: #44cc66;
    color: #44cc66;
  }
  .btn-next:hover { background: #44cc66; color: #0d1411; }
  .btn-next:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .btn-next:disabled:hover { background: transparent; color: #44cc66; }
  .error { color: #cc4444; font-size: 11px; margin-top: 6px; }
</style>
</head>
<body>
<div class="wizard">
  <div class="header">
    <h1>JHT Desktop</h1>
    <p class="sub">Job Hunter Team — Setup</p>
  </div>

  <div class="steps" id="stepDots"></div>

  <div class="content">
    <!-- Step 1: Workspace -->
    <div class="step" id="step-0">
      <div class="field">
        <label>Working directory</label>
        <input type="text" id="workDir" placeholder="C:\Users\you\JHT" />
        <div class="hint">Where your job search data will be stored</div>
      </div>
    </div>

    <!-- Step 2: Provider -->
    <div class="step" id="step-1">
      <div class="field">
        <label>AI Provider</label>
        <div id="providerList">
          <div class="provider-card" data-value="anthropic" onclick="selectProvider(this)">
            <div class="dot"></div>
            <div><div class="name">Anthropic</div><div class="desc">Claude via Messages API</div></div>
          </div>
          <div class="provider-card" data-value="openai" onclick="selectProvider(this)">
            <div class="dot"></div>
            <div><div class="name">OpenAI</div><div class="desc">Codex OAuth + API key</div></div>
          </div>
          <div class="provider-card" data-value="kimi" onclick="selectProvider(this)">
            <div class="dot"></div>
            <div><div class="name">Moonshot AI</div><div class="desc">Kimi K2.5</div></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Step 3: Auth method (only for OpenAI) -->
    <div class="step" id="step-2">
      <div class="field">
        <label>Authentication method</label>
        <div id="authMethodList"></div>
      </div>
    </div>

    <!-- Step 4: Credentials -->
    <div class="step" id="step-3">
      <div class="field">
        <label id="credLabel">API Key</label>
        <input type="password" id="apiKey" placeholder="" />
        <div class="hint" id="credHint">Your key is stored locally and never shared</div>
        <div class="error" id="credError"></div>
      </div>
    </div>
  </div>

  <div class="footer">
    <button class="btn btn-back" id="btnBack" onclick="goBack()" style="display:none">Back</button>
    <button class="btn btn-next" id="btnNext" onclick="goNext()">Next</button>
  </div>
</div>

<script>
  const STEPS = ['workspace', 'provider', 'authMethod', 'credentials'];
  const TOTAL_STEPS = 4;
  let currentStep = 0;
  let selectedProvider = 'DEFAULT_PROVIDER';
  let selectedAuthMethod = '';

  const AUTH_METHODS = {
    anthropic: [{ id: 'api-key', label: 'API Key', hint: 'sk-ant-...', kind: 'apiKey' }],
    openai: [
      { id: 'oauth', label: 'OAuth (Codex)', hint: 'Browser login', kind: 'oauth' },
      { id: 'api-key', label: 'API Key', hint: 'sk-...', kind: 'apiKey' }
    ],
    kimi: [{ id: 'api-key', label: 'API Key', hint: 'sk-...', kind: 'apiKey' }],
  };

  const PLACEHOLDERS = {
    anthropic: 'sk-ant-api03-...',
    openai: 'sk-proj-...',
    kimi: 'sk-...',
  };

  function init() {
    document.getElementById('workDir').value = 'DEFAULT_WORK_DIR';
    if (selectedProvider) selectProviderByValue(selectedProvider);
    renderStepDots();
    showStep(0);
  }

  function renderStepDots() {
    const el = document.getElementById('stepDots');
    el.innerHTML = '';
    for (let i = 0; i < TOTAL_STEPS; i++) {
      const dot = document.createElement('div');
      dot.className = 'step-dot' + (i < currentStep ? ' done' : '') + (i === currentStep ? ' active' : '');
      el.appendChild(dot);
    }
  }

  function showStep(n) {
    currentStep = n;
    document.querySelectorAll('.step').forEach((el, i) => {
      el.classList.toggle('active', i === n);
    });
    document.getElementById('btnBack').style.display = n > 0 ? '' : 'none';

    const isLast = n === TOTAL_STEPS - 1;
    document.getElementById('btnNext').textContent = isLast ? 'Start JHT' : 'Next';

    // Skip authMethod step if provider has only 1 method
    if (n === 2 && selectedProvider) {
      const methods = AUTH_METHODS[selectedProvider] || [];
      if (methods.length <= 1) {
        selectedAuthMethod = methods[0]?.id || 'api-key';
        showStep(3);
        setupCredentialsStep();
        return;
      }
      renderAuthMethods();
    }

    if (n === 3) setupCredentialsStep();

    renderStepDots();
  }

  function selectProvider(el) {
    document.querySelectorAll('.provider-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    selectedProvider = el.dataset.value;
  }

  function selectProviderByValue(val) {
    const card = document.querySelector(`.provider-card[data-value="${val}"]`);
    if (card) selectProvider(card);
  }

  function renderAuthMethods() {
    const list = document.getElementById('authMethodList');
    list.innerHTML = '';
    const methods = AUTH_METHODS[selectedProvider] || [];
    methods.forEach(m => {
      const card = document.createElement('div');
      card.className = 'provider-card' + (selectedAuthMethod === m.id ? ' selected' : '');
      card.dataset.value = m.id;
      card.onclick = function() { selectAuthMethod(this); };
      card.innerHTML = '<div class="dot"></div><div><div class="name">' + m.label + '</div><div class="desc">' + (m.hint || '') + '</div></div>';
      list.appendChild(card);
    });
  }

  function selectAuthMethod(el) {
    document.querySelectorAll('#authMethodList .provider-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    selectedAuthMethod = el.dataset.value;
  }

  function setupCredentialsStep() {
    const method = (AUTH_METHODS[selectedProvider] || []).find(m => m.id === selectedAuthMethod);
    if (method && method.kind === 'oauth') {
      document.getElementById('credLabel').textContent = 'OAuth';
      document.getElementById('apiKey').style.display = 'none';
      document.getElementById('credHint').textContent = 'Click "Start JHT" to open browser for authentication';
    } else {
      document.getElementById('credLabel').textContent = 'API Key';
      document.getElementById('apiKey').style.display = '';
      document.getElementById('apiKey').placeholder = PLACEHOLDERS[selectedProvider] || 'sk-...';
      document.getElementById('credHint').textContent = 'Your key is stored locally and never shared';
    }
    document.getElementById('credError').textContent = '';
  }

  function goBack() {
    if (currentStep <= 0) return;
    let prev = currentStep - 1;
    // Skip authMethod if provider has only 1 method
    if (prev === 2 && selectedProvider) {
      const methods = AUTH_METHODS[selectedProvider] || [];
      if (methods.length <= 1) prev = 1;
    }
    showStep(prev);
  }

  function goNext() {
    const err = document.getElementById('credError');
    if (err) err.textContent = '';

    if (currentStep === 0) {
      const dir = document.getElementById('workDir').value.trim();
      if (!dir) { if(err) err.textContent = 'Please enter a directory'; return; }
      showStep(1);
    } else if (currentStep === 1) {
      if (!selectedProvider) { if(err) err.textContent = 'Please select a provider'; return; }
      showStep(2);
    } else if (currentStep === 2) {
      if (!selectedAuthMethod) { if(err) err.textContent = 'Please select an auth method'; return; }
      showStep(3);
    } else if (currentStep === 3) {
      const method = (AUTH_METHODS[selectedProvider] || []).find(m => m.id === selectedAuthMethod);
      const apiKey = document.getElementById('apiKey').value.trim();
      if (method && method.kind !== 'oauth' && !apiKey) {
        document.getElementById('credError').textContent = 'Please enter your API key';
        return;
      }
      // Validate key prefix
      if (selectedProvider === 'anthropic' && apiKey && !apiKey.startsWith('sk-ant-')) {
        document.getElementById('credError').textContent = 'Anthropic key must start with sk-ant-';
        return;
      }
      // Submit
      const data = {
        work_dir: document.getElementById('workDir').value.trim(),
        provider: selectedProvider,
        auth_method: selectedAuthMethod,
        api_key: apiKey,
      };
      window.ipc.postMessage('submit:' + JSON.stringify(data));
    }
  }

  // Keyboard: Enter to proceed
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') goNext();
    if (e.key === 'Escape') goBack();
  });

  init();
</script>
</body>
</html>"##;

pub fn run(existing: Option<SetupConfig>) -> Option<SetupConfig> {
    let result: Arc<Mutex<Option<SetupConfig>>> = Arc::new(Mutex::new(None));
    let result_clone = Arc::clone(&result);

    let default_dir = existing
        .as_ref()
        .map(|c| c.work_dir.display().to_string())
        .unwrap_or_else(|| {
            let home = std::env::var("USERPROFILE").unwrap_or_default();
            format!("{}\\JHT", home)
        });

    let default_provider = existing
        .as_ref()
        .map(|c| c.provider.clone())
        .unwrap_or_default();

    let html = WIZARD_HTML
        .replace("DEFAULT_WORK_DIR", &default_dir.replace('\\', "\\\\"))
        .replace("DEFAULT_PROVIDER", &default_provider);

    let event_loop = EventLoop::new();

    let window = WindowBuilder::new()
        .with_title("JHT Desktop")
        .with_inner_size(LogicalSize::new(480.0, 480.0))
        .with_resizable(false)
        .build(&event_loop)
        .unwrap();

    let _webview = WebViewBuilder::new()
        .with_html(&html)
        .with_ipc_handler(move |msg| {
            let body = msg.body();
            if body.starts_with("submit:") {
                let json = &body[7..];
                if let Some(cfg) = parse_submit(json) {
                    *result_clone.lock().unwrap() = Some(cfg);
                }
            }
        })
        .build(&window)
        .unwrap();

    let result_check = Arc::clone(&result);

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }

        if result_check.lock().unwrap().is_some() {
            *control_flow = ControlFlow::Exit;
        }
    });
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
