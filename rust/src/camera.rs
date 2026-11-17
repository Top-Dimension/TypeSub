use std::io::{self, Read};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

const WIDTH: usize = 1280;
const HEIGHT: usize = 720;
const FRAME_BYTES: usize = WIDTH * HEIGHT * 4;

#[cfg(windows)]
mod capture {
    use std::ffi::{c_void, CString};
    use std::ptr;

    type Handle = *mut c_void;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const MUTEX_MODIFY_STATE: u32 = 0x0001;
    const EVENT_MODIFY_STATE: u32 = 0x0002;
    const FILE_MAP_WRITE: u32 = 0x0002;
    const WAIT_OBJECT_0: u32 = 0;

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenMutexA(access: u32, inherit: i32, name: *const i8) -> Handle;
        fn OpenEventA(access: u32, inherit: i32, name: *const i8) -> Handle;
        fn CreateEventA(
            attributes: *mut c_void,
            manual_reset: i32,
            initial_state: i32,
            name: *const i8,
        ) -> Handle;
        fn OpenFileMappingA(access: u32, inherit: i32, name: *const i8) -> Handle;
        fn MapViewOfFile(
            mapping: Handle,
            access: u32,
            high: u32,
            low: u32,
            size: usize,
        ) -> *mut c_void;
        fn UnmapViewOfFile(view: *mut c_void) -> i32;
        fn WaitForSingleObject(handle: Handle, timeout: u32) -> u32;
        fn ReleaseMutex(handle: Handle) -> i32;
        fn SetEvent(handle: Handle) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    #[repr(C)]
    struct Header {
        max_size: u32,
        width: i32,
        height: i32,
        stride: i32,
        format: i32,
        resize_mode: i32,
        mirror_mode: i32,
        timeout: i32,
    }

    pub struct Sender {
        mutex: Handle,
        want: Handle,
        sent: Handle,
        mapping: Handle,
        view: *mut c_void,
    }

    impl Sender {
        pub fn open() -> Option<Self> {
            unsafe {
                let name = |s: &str| CString::new(s).unwrap();
                let mutex = OpenMutexA(
                    SYNCHRONIZE | MUTEX_MODIFY_STATE,
                    0,
                    name("TypeSubCam_Mutx").as_ptr(),
                );
                if mutex.is_null() {
                    return None;
                }
                let want = CreateEventA(
                    ptr::null_mut(),
                    0,
                    0,
                    name("TypeSubCam_Want").as_ptr(),
                );
                let sent = OpenEventA(EVENT_MODIFY_STATE, 0, name("TypeSubCam_Sent").as_ptr());
                let mapping =
                    OpenFileMappingA(FILE_MAP_WRITE, 0, name("TypeSubCam_Data").as_ptr());
                let view = if mapping.is_null() {
                    ptr::null_mut()
                } else {
                    MapViewOfFile(mapping, FILE_MAP_WRITE, 0, 0, 0)
                };
                if want.is_null() || sent.is_null() || view.is_null() {
                    for handle in [mutex, want, sent, mapping] {
                        if !handle.is_null() {
                            CloseHandle(handle);
                        }
                    }
                    if !view.is_null() {
                        UnmapViewOfFile(view);
                    }
                    return None;
                }
                Some(Self {
                    mutex,
                    want,
                    sent,
                    mapping,
                    view,
                })
            }
        }

        pub fn send(&self, pixels: &[u8], width: usize, height: usize) -> bool {
            if pixels.len() != width * height * 4 {
                return false;
            }
            unsafe {
                if WaitForSingleObject(self.mutex, 100) != WAIT_OBJECT_0 {
                    return false;
                }
                let header = &mut *(self.view as *mut Header);
                if header.width != 0 && WaitForSingleObject(self.want, 0) != WAIT_OBJECT_0 {
                    ReleaseMutex(self.mutex);
                    return true;
                }
                if pixels.len() > header.max_size as usize {
                    ReleaseMutex(self.mutex);
                    return false;
                }
                header.width = width as i32;
                header.height = height as i32;
                header.stride = width as i32;
                header.format = 0; // UnityCapture FORMAT_UINT8, RGBA byte order.
                header.resize_mode = 0;
                header.mirror_mode = 0;
                header.timeout = 1000;
                ptr::copy_nonoverlapping(
                    pixels.as_ptr(),
                    (self.view as *mut u8).add(std::mem::size_of::<Header>()),
                    pixels.len(),
                );
                ReleaseMutex(self.mutex);
                SetEvent(self.sent);
                true
            }
        }
    }

    impl Drop for Sender {
        fn drop(&mut self) {
            unsafe {
                UnmapViewOfFile(self.view);
                for handle in [self.mutex, self.want, self.sent, self.mapping] {
                    CloseHandle(handle);
                }
            }
        }
    }
}

fn read_frames() -> mpsc::Receiver<Vec<u8>> {
    let (tx, rx) = mpsc::sync_channel(2);
    thread::spawn(move || {
        let mut input = io::stdin().lock();
        let mut frame = vec![0; FRAME_BYTES];
        loop {
            let mut size = [0; 4];
            if input.read_exact(&mut size).is_err() {
                break;
            }
            if u32::from_le_bytes(size) as usize != FRAME_BYTES
                || input.read_exact(&mut frame).is_err()
            {
                break;
            }
            if tx.send(frame.clone()).is_err() {
                break;
            }
        }
    });
    rx
}

fn main() {
    let rx = read_frames();
    let mut current = None;
    #[cfg(windows)]
    let mut sender = None;
    loop {
        match rx.recv_timeout(Duration::from_millis(33)) {
            Ok(frame) => {
                current = Some(frame);
                while let Ok(frame) = rx.try_recv() {
                    current = Some(frame);
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
        #[cfg(windows)]
        if let Some(frame) = &current {
            if sender.is_none() {
                sender = capture::Sender::open();
            }
            if let Some(active) = &sender {
                if !active.send(frame, WIDTH, HEIGHT) {
                    sender = None;
                }
            }
        }
    }
}
