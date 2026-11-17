#[cfg(windows)]
mod windows {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    #[link(name = "shell32")]
    extern "system" {
        fn IsUserAnAdmin() -> i32;
        fn ShellExecuteW(
            hwnd: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> isize;
        fn ShellExecuteExW(info: *mut ShellExecuteInfo) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn WaitForSingleObject(handle: *mut c_void, timeout: u32) -> u32;
        fn GetExitCodeProcess(handle: *mut c_void, code: *mut u32) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    #[repr(C)]
    struct ShellExecuteInfo {
        size: u32,
        mask: u32,
        hwnd: *mut c_void,
        verb: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show: i32,
        instance: *mut c_void,
        id_list: *mut c_void,
        class: *const u16,
        class_key: *mut c_void,
        hot_key: u32,
        icon_or_monitor: *mut c_void,
        process: *mut c_void,
    }

    fn wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }

    // Match Windows command-line quoting so paths containing spaces survive relaunch.
    fn quote_arg(arg: &str) -> String {
        let mut quoted = String::from("\"");
        let mut backslashes = 0;
        for ch in arg.chars() {
            match ch {
                '\\' => backslashes += 1,
                '"' => {
                    quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
                    quoted.push('"');
                    backslashes = 0;
                }
                _ => {
                    quoted.push_str(&"\\".repeat(backslashes));
                    backslashes = 0;
                    quoted.push(ch);
                }
            }
        }
        quoted.push_str(&"\\".repeat(backslashes * 2));
        quoted.push('"');
        quoted
    }

    pub fn run() -> Result<(), String> {
        let mut args = std::env::args_os().skip(1);
        let executable = args.next().ok_or("Missing executable path")?;
        let parameters = args
            .map(|arg| quote_arg(&arg.to_string_lossy()))
            .collect::<Vec<_>>()
            .join(" ");
        let operation = wide(OsStr::new("runas"));
        let executable = wide(&executable);
        let parameters = wide(OsStr::new(&parameters));
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                executable.as_ptr(),
                parameters.as_ptr(),
                std::ptr::null(),
                1,
            )
        };
        if result <= 32 {
            return Err(format!(
                "UAC request was cancelled or failed (code {result})"
            ));
        }
        Ok(())
    }

    pub fn is_admin() -> bool {
        unsafe { IsUserAnAdmin() != 0 }
    }

    pub fn install_camera(dll: &Path, uninstall: bool) -> Result<(), String> {
        if !dll.is_file() {
            return Err("Camera DLL not found".into());
        }
        let system_root = std::env::var_os("SystemRoot").ok_or("SystemRoot is missing")?;
        let regsvr = Path::new(&system_root).join("System32").join("regsvr32.exe");
        let file = wide(regsvr.as_os_str());
        let verb = wide(OsStr::new("runas"));
        let parameters = if uninstall {
            format!("/s /u {}", quote_arg(&dll.to_string_lossy()))
        } else {
            format!("/s {}", quote_arg(&dll.to_string_lossy()))
        };
        let parameters = wide(OsStr::new(&parameters));
        let mut info = ShellExecuteInfo {
            size: std::mem::size_of::<ShellExecuteInfo>() as u32,
            mask: 0x40, // SEE_MASK_NOCLOSEPROCESS
            hwnd: std::ptr::null_mut(),
            verb: verb.as_ptr(),
            file: file.as_ptr(),
            parameters: parameters.as_ptr(),
            directory: std::ptr::null(),
            show: 0,
            instance: std::ptr::null_mut(),
            id_list: std::ptr::null_mut(),
            class: std::ptr::null(),
            class_key: std::ptr::null_mut(),
            hot_key: 0,
            icon_or_monitor: std::ptr::null_mut(),
            process: std::ptr::null_mut(),
        };
        unsafe {
            if ShellExecuteExW(&mut info) == 0 || info.process.is_null() {
                return Err(format!("UAC request cancelled or failed: {}", std::io::Error::last_os_error()));
            }
            WaitForSingleObject(info.process, u32::MAX);
            let mut code = u32::MAX;
            let ok = GetExitCodeProcess(info.process, &mut code) != 0;
            CloseHandle(info.process);
            if !ok || code != 0 {
                return Err(format!("regsvr32 failed with exit code {code}"));
            }
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::quote_arg;

        #[test]
        fn quotes_paths_and_trailing_backslashes() {
            assert_eq!(
                quote_arg(r"C:\Program Files\TypeSub\"),
                r#""C:\Program Files\TypeSub\\""#
            );
            assert_eq!(quote_arg(r#"a"b"#), r#""a\"b""#);
        }
    }
}

fn main() {
    #[cfg(windows)]
    {
        let args: Vec<_> = std::env::args_os().collect();
        if args.get(1).map(|s| s.as_os_str()) == Some(std::ffi::OsStr::new("--check")) {
            std::process::exit(if windows::is_admin() { 0 } else { 1 });
        }
        if matches!(
            args.get(1).map(|s| s.as_os_str()),
            Some(s) if s == std::ffi::OsStr::new("--install-camera")
                || s == std::ffi::OsStr::new("--uninstall-camera")
        ) {
            let dll = args.get(2).expect("Camera DLL path required");
            if let Err(error) = windows::install_camera(
                std::path::Path::new(dll),
                args[1] == std::ffi::OsStr::new("--uninstall-camera"),
            ) {
                eprintln!("{error}");
                std::process::exit(1);
            }
            return;
        }
    }
    #[cfg(windows)]
    if let Err(error) = windows::run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
    #[cfg(not(windows))]
    {
        eprintln!("UAC is only available on Windows");
        std::process::exit(1);
    }
}
