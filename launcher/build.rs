fn main() {
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("assets/icon.ico");
        res.set("ProductName", "JHT Desktop");
        res.set("FileDescription", "Job Hunter Team Launcher");
        res.compile().unwrap();
    }
}
