//! The app's windows open inside the work area of their monitor: the screen
//! minus the taskbar or the dock, at the monitor's own scale. A size written
//! in the configuration (or in a builder) is what the window wants; on a small
//! screen, or at 125% or 150%, it is cut to what fits, its minimum with it,
//! and the window is centred in the work area. On a screen large enough
//! nothing changes but the centring.
//!
//! The arithmetic is one pure function (`fit`), tested on fake work areas;
//! the two callers only read the monitor and apply the result.

use tauri::{LogicalSize, Manager, Monitor, PhysicalPosition, WebviewWindow};

/// What the window's frame adds around its content (title bar and borders),
/// in logical pixels: the inner size is what the app sets, the outer one is
/// what must fit. Generous on purpose: Windows 11 at 125% draws a 32 px
/// title bar and 8 px borders.
const FRAME_WIDTH: f64 = 16.0;
const FRAME_HEIGHT: f64 = 40.0;
/// Below this a window is not usable: if the work area is smaller still, the
/// window takes the whole work area.
const FLOOR_WIDTH: f64 = 480.0;
const FLOOR_HEIGHT: f64 = 360.0;

/// A monitor's work area, in physical pixels, and its scale.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct WorkArea {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) scale: f64,
}

/// Where and how large a window opens: the position in physical pixels (the
/// outer top-left corner), the sizes in logical pixels (inner).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Fit {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) min_width: f64,
    pub(crate) min_height: f64,
}

impl WorkArea {
    pub(crate) fn of(monitor: &Monitor) -> Self {
        let area = monitor.work_area();
        Self {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
            scale: monitor.scale_factor(),
        }
    }
}

/// The window's inner size and minimum, cut to the work area, and its outer
/// box centred in it.
pub(crate) fn fit(area: &WorkArea, wanted: (f64, f64), min: (f64, f64)) -> Fit {
    let scale = if area.scale.is_finite() && area.scale > 0.0 { area.scale } else { 1.0 };
    // the room for the content: the work area, in logical pixels, minus the frame
    let room_width = (area.width as f64 / scale - FRAME_WIDTH).max(1.0);
    let room_height = (area.height as f64 / scale - FRAME_HEIGHT).max(1.0);
    let cut = |want: f64, room: f64, floor: f64| want.min(room).max(floor.min(room)).floor();
    let width = cut(wanted.0, room_width, FLOOR_WIDTH);
    let height = cut(wanted.1, room_height, FLOOR_HEIGHT);
    // a minimum larger than what fits would push the window out again
    let min_width = min.0.min(width);
    let min_height = min.1.min(height);
    let outer_width = ((width + FRAME_WIDTH) * scale).round() as i64;
    let outer_height = ((height + FRAME_HEIGHT) * scale).round() as i64;
    let x = area.x as i64 + ((area.width as i64 - outer_width) / 2).max(0);
    let y = area.y as i64 + ((area.height as i64 - outer_height) / 2).max(0);
    Fit {
        x: x as i32,
        y: y as i32,
        width,
        height,
        min_width,
        min_height,
    }
}

/// The monitor the window is on, or the primary one.
fn monitor_of(window: &WebviewWindow) -> Option<Monitor> {
    window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
}

/// Applies a fit to a window that already exists.
pub(crate) fn apply(window: &WebviewWindow, fit: &Fit) {
    let _ = window.set_min_size(Some(LogicalSize::new(fit.min_width, fit.min_height)));
    let _ = window.set_size(LogicalSize::new(fit.width, fit.height));
    let _ = window.set_position(PhysicalPosition::new(fit.x, fit.y));
}

/// The main window, at start: the configuration's size and minimum, cut to the
/// work area of its monitor.
pub(crate) fn fit_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Some(config) = app.config().app.windows.iter().find(|config| config.label == "main") else {
        return;
    };
    let Some(monitor) = monitor_of(&window) else {
        return;
    };
    let wanted = (config.width, config.height);
    let min = (config.min_width.unwrap_or(FLOOR_WIDTH), config.min_height.unwrap_or(FLOOR_HEIGHT));
    apply(&window, &fit(&WorkArea::of(&monitor), wanted, min));
}

/// A window the app opens later (the live screen, the LinkedIn login view):
/// its size cut to the work area of the monitor the main window is on.
pub(crate) fn fit_new_window(window: &WebviewWindow, wanted: (f64, f64), min: (f64, f64)) {
    let app = window.app_handle();
    let monitor = app
        .get_webview_window("main")
        .and_then(|main| monitor_of(&main))
        .or_else(|| monitor_of(window));
    if let Some(monitor) = monitor {
        apply(window, &fit(&WorkArea::of(&monitor), wanted, min));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The work area of a screen with a taskbar of `bar` physical pixels at the bottom.
    fn screen(width: u32, height: u32, bar: u32, scale: f64) -> WorkArea {
        WorkArea { x: 0, y: 0, width, height: height - bar, scale }
    }

    /// The outer box of a fit, in physical pixels, lies inside the work area.
    fn inside(area: &WorkArea, fit: &Fit) -> bool {
        let outer_width = ((fit.width + FRAME_WIDTH) * area.scale).round() as i64;
        let outer_height = ((fit.height + FRAME_HEIGHT) * area.scale).round() as i64;
        fit.x as i64 >= area.x as i64
            && fit.y as i64 >= area.y as i64
            && fit.x as i64 + outer_width <= area.x as i64 + area.width as i64
            && fit.y as i64 + outer_height <= area.y as i64 + area.height as i64
    }

    // The main window's configuration, and the live screen's builder.
    const MAIN: ((f64, f64), (f64, f64)) = ((1180.0, 760.0), (860.0, 620.0));
    const LIVE: ((f64, f64), (f64, f64)) = ((1180.0, 860.0), (480.0, 360.0));

    #[test]
    fn no_window_goes_past_the_work_area() {
        // Windows' taskbar: 40 px at 100%, 48 px at 125% and 150%
        for area in [
            screen(1366, 768, 40, 1.0),
            screen(1366, 768, 48, 1.25),
            screen(1920, 1080, 48, 1.5),
            screen(1280, 720, 40, 1.0),
            screen(1920, 1080, 40, 1.0),
            screen(2560, 1440, 60, 2.0),
        ] {
            for (wanted, min) in [MAIN, LIVE] {
                let fit = fit(&area, wanted, min);
                assert!(inside(&area, &fit), "{area:?} {wanted:?} -> {fit:?}");
                assert!(fit.min_width <= fit.width && fit.min_height <= fit.height, "{fit:?}");
                assert!(fit.width <= wanted.0 && fit.height <= wanted.1, "{fit:?}");
            }
        }
    }

    #[test]
    fn at_125_percent_on_1366x768_the_main_window_is_cut_to_the_logical_work_area() {
        let area = screen(1366, 768, 48, 1.25);
        let fit = fit(&area, MAIN.0, MAIN.1);
        // 1366 / 1.25 = 1092.8 wide, (768 - 48) / 1.25 = 576 high, minus the frame
        assert_eq!((fit.width, fit.height), (1076.0, 536.0));
        // its minimum is cut with it: 620 would push it under the taskbar again
        assert_eq!((fit.min_width, fit.min_height), (860.0, 536.0));
        assert_eq!(fit.y, 0);
    }

    #[test]
    fn the_live_screen_fits_even_at_100_percent() {
        let area = screen(1366, 768, 40, 1.0);
        let fit = fit(&area, LIVE.0, LIVE.1);
        assert_eq!((fit.width, fit.height), (1180.0, 688.0));
        assert!(inside(&area, &fit));
    }

    #[test]
    fn on_a_large_screen_the_size_stays_and_the_window_is_centred() {
        let area = screen(2560, 1440, 40, 1.0);
        let fit = fit(&area, MAIN.0, MAIN.1);
        assert_eq!((fit.width, fit.height, fit.min_width, fit.min_height), (1180.0, 760.0, 860.0, 620.0));
        assert_eq!((fit.x, fit.y), ((2560 - 1196) / 2, (1400 - 800) / 2));
    }

    #[test]
    fn a_work_area_that_does_not_start_at_zero_is_respected() {
        // a second monitor on the left, a taskbar at the top
        let area = WorkArea { x: -1366, y: 48, width: 1366, height: 720, scale: 1.25 };
        let fit = fit(&area, MAIN.0, MAIN.1);
        assert!(inside(&area, &fit), "{fit:?}");
        assert!(fit.x >= -1366 && fit.y >= 48);
    }

    #[test]
    fn a_tiny_or_strange_area_never_gives_a_window_past_it() {
        for area in [
            WorkArea { x: 0, y: 0, width: 800, height: 400, scale: 1.0 },
            WorkArea { x: 0, y: 0, width: 300, height: 200, scale: 1.0 },
            WorkArea { x: 0, y: 0, width: 1366, height: 728, scale: 0.0 },
            WorkArea { x: 0, y: 0, width: 1366, height: 728, scale: f64::NAN },
        ] {
            let fit = fit(&area, MAIN.0, MAIN.1);
            let scale = if area.scale.is_finite() && area.scale > 0.0 { area.scale } else { 1.0 };
            assert!(inside(&WorkArea { scale, ..area }, &fit), "{area:?} -> {fit:?}");
            assert!(fit.width >= 1.0 && fit.height >= 1.0);
        }
    }
}
