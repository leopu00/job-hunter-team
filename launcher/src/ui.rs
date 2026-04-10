#[cfg(windows)]
use std::sync::Mutex;
#[cfg(windows)]
use std::sync::atomic::{AtomicIsize, Ordering};

#[cfg(windows)]
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
#[cfg(windows)]
use windows_sys::Win32::Graphics::Gdi::*;
#[cfg(windows)]
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::*;

#[cfg(windows)]
static STATUS_TEXT: Mutex<String> = Mutex::new(String::new());
#[cfg(windows)]
static WINDOW_HANDLE: AtomicIsize = AtomicIsize::new(0);
#[cfg(windows)]
static STEP_CURRENT: Mutex<u8> = Mutex::new(0);
#[cfg(windows)]
static STEP_TOTAL: Mutex<u8> = Mutex::new(10);

#[cfg(windows)]
fn get_hwnd() -> HWND {
    WINDOW_HANDLE.load(Ordering::SeqCst) as HWND
}

#[cfg(windows)]
fn set_hwnd(hwnd: HWND) {
    WINDOW_HANDLE.store(hwnd as isize, Ordering::SeqCst);
}

#[cfg(windows)]
pub fn show_error(title: &str, message: &str) {
    let title_w: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
    let msg_w: Vec<u16> = message.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            msg_w.as_ptr(),
            title_w.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(windows)]
pub fn update_status(step: u8, message: &str) {
    if let Ok(mut s) = STATUS_TEXT.lock() {
        *s = message.to_string();
    }
    if let Ok(mut s) = STEP_CURRENT.lock() {
        *s = step;
    }
    let hwnd = get_hwnd();
    if !hwnd.is_null() {
        unsafe {
            InvalidateRect(hwnd, std::ptr::null(), 1);
            UpdateWindow(hwnd);
        }
    }
}

#[cfg(windows)]
pub fn create_splash() -> std::thread::JoinHandle<()> {
    std::thread::spawn(|| unsafe { run_splash_window() })
}

#[cfg(windows)]
pub fn close_splash() {
    let hwnd = get_hwnd();
    if !hwnd.is_null() {
        unsafe {
            PostMessageW(hwnd, WM_CLOSE, 0, 0);
        }
    }
}

#[cfg(windows)]
unsafe fn run_splash_window() {
    let class_name: Vec<u16> = "JHTSplash\0".encode_utf16().collect();
    let title: Vec<u16> = "JHT Desktop\0".encode_utf16().collect();
    let hinstance = GetModuleHandleW(std::ptr::null());

    let wc = WNDCLASSW {
        style: 0,
        lpfnWndProc: Some(splash_wndproc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: hinstance,
        hIcon: LoadIconW(hinstance, 1 as *const u16),
        hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
        hbrBackground: std::ptr::null_mut(),
        lpszMenuName: std::ptr::null(),
        lpszClassName: class_name.as_ptr(),
    };
    RegisterClassW(&wc);

    let screen_w = GetSystemMetrics(SM_CXSCREEN);
    let screen_h = GetSystemMetrics(SM_CYSCREEN);
    let win_w = 420;
    let win_h = 200;
    let x = (screen_w - win_w) / 2;
    let y = (screen_h - win_h) / 2;

    let hwnd = CreateWindowExW(
        WS_EX_TOPMOST,
        class_name.as_ptr(),
        title.as_ptr(),
        WS_POPUP | WS_VISIBLE | WS_BORDER,
        x, y, win_w, win_h,
        std::ptr::null_mut(),
        std::ptr::null_mut(),
        hinstance,
        std::ptr::null(),
    );

    set_hwnd(hwnd);

    ShowWindow(hwnd, SW_SHOW);
    UpdateWindow(hwnd);

    let mut msg = std::mem::zeroed::<MSG>();
    while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

#[cfg(windows)]
unsafe extern "system" fn splash_wndproc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_PAINT => {
            let mut ps = std::mem::zeroed::<PAINTSTRUCT>();
            let hdc = BeginPaint(hwnd, &mut ps);

            let mut rect = std::mem::zeroed::<RECT>();
            GetClientRect(hwnd, &mut rect);

            // Dark background
            let bg_brush = CreateSolidBrush(0x00140D0D); // dark
            FillRect(hdc, &rect, bg_brush);
            DeleteObject(bg_brush as _);

            SetBkMode(hdc, 1); // TRANSPARENT

            // Title "JHT Desktop" in green
            SetTextColor(hdc, 0x0044CC66); // green BGR
            let font = CreateFontW(
                24, 0, 0, 0, 700, 0, 0, 0, 0, 0, 0, 0, 0,
                "Segoe UI\0".encode_utf16().collect::<Vec<u16>>().as_ptr(),
            );
            let old_font = SelectObject(hdc, font as _);

            let title: Vec<u16> = "JHT Desktop".encode_utf16().chain(std::iter::once(0)).collect();
            let mut title_rect = RECT { left: 0, top: 30, right: rect.right, bottom: 70 };
            DrawTextW(hdc, title.as_ptr(), -1, &mut title_rect, DT_CENTER | DT_SINGLELINE);

            // Status text in white, smaller font
            let font_small = CreateFontW(
                14, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0,
                "Segoe UI\0".encode_utf16().collect::<Vec<u16>>().as_ptr(),
            );
            SelectObject(hdc, font_small as _);
            SetTextColor(hdc, 0x00CCCCCC);

            let status = STATUS_TEXT.lock().map(|s| s.clone()).unwrap_or_default();
            let status_w: Vec<u16> = status.encode_utf16().chain(std::iter::once(0)).collect();
            let mut status_rect = RECT { left: 20, top: 80, right: rect.right - 20, bottom: 110 };
            DrawTextW(hdc, status_w.as_ptr(), -1, &mut status_rect, DT_CENTER | DT_SINGLELINE);

            // Progress bar
            let bar_left = 60;
            let bar_right = rect.right - 60;
            let bar_top = 130;
            let bar_bottom = 146;

            let bar_bg = CreateSolidBrush(0x00333333);
            let bar_rect = RECT { left: bar_left, top: bar_top, right: bar_right, bottom: bar_bottom };
            FillRect(hdc, &bar_rect, bar_bg);
            DeleteObject(bar_bg as _);

            let current = STEP_CURRENT.lock().map(|s| *s).unwrap_or(0) as i32;
            let total = STEP_TOTAL.lock().map(|s| *s).unwrap_or(6) as i32;
            if total > 0 && current > 0 {
                let fill_width = ((bar_right - bar_left) * current) / total;
                let bar_fill = CreateSolidBrush(0x0044CC66); // green
                let fill_rect = RECT { left: bar_left, top: bar_top, right: bar_left + fill_width, bottom: bar_bottom };
                FillRect(hdc, &fill_rect, bar_fill);
                DeleteObject(bar_fill as _);
            }

            // Step counter
            SetTextColor(hdc, 0x00666666);
            let step_text = format!("{}/{}", current, total);
            let step_w: Vec<u16> = step_text.encode_utf16().chain(std::iter::once(0)).collect();
            let mut step_rect = RECT { left: 0, top: 155, right: rect.right, bottom: 180 };
            DrawTextW(hdc, step_w.as_ptr(), -1, &mut step_rect, DT_CENTER | DT_SINGLELINE);

            // Cleanup
            SelectObject(hdc, old_font);
            DeleteObject(font as _);
            DeleteObject(font_small as _);

            EndPaint(hwnd, &ps);
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

#[cfg(windows)]
pub fn show_info(title: &str, message: &str) {
    let title_w: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
    let msg_w: Vec<u16> = message.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            msg_w.as_ptr(),
            title_w.as_ptr(),
            MB_OK | MB_ICONINFORMATION,
        );
    }
}

#[cfg(not(windows))]
pub fn show_error(_title: &str, message: &str) {
    eprintln!("ERROR: {}", message);
}

#[cfg(not(windows))]
pub fn show_info(_title: &str, message: &str) {
    println!("INFO: {}", message);
}

#[cfg(not(windows))]
pub fn update_status(_step: u8, message: &str) {
    println!("{}", message);
}

#[cfg(not(windows))]
pub fn create_splash() -> std::thread::JoinHandle<()> {
    std::thread::spawn(|| {})
}

#[cfg(not(windows))]
pub fn close_splash() {}
