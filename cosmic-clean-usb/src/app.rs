use cosmic::app::{Core, Task};
use cosmic::iced::Length;
use cosmic::widget;
use cosmic::Application;
use cosmic::Element;

use crate::pages;
use crate::usb::{self, UsbDevice, WipeMode, WipeResult};

pub const APP_ID: &str = "com.banglabs.CleanUsb";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Page {
    Devices,
    Wiping,
    Result,
}

#[derive(Debug, Clone)]
pub enum Message {
    Refresh,
    DevicesLoaded(Vec<UsbDevice>),
    QuickWipe(String),
    SecureWipe(String),
    OpenBrowser(String),
    WipeComplete(Box<WipeResult>),
    WipeFailed(String),
    BackToDevices,
    OpenMountPoint(String),
}

pub struct CleanUsb {
    core: Core,
    pub page: Page,
    pub devices: Vec<UsbDevice>,
    pub loading: bool,
    pub wipe_in_progress: Option<WipeProgress>,
    pub last_result: Option<WipeResult>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WipeProgress {
    pub device: String,
    pub model: String,
    pub mode: WipeMode,
    pub elapsed_secs: u64,
}

impl Application for CleanUsb {
    type Executor = cosmic::executor::Default;
    type Flags = ();
    type Message = Message;

    const APP_ID: &'static str = APP_ID;

    fn core(&self) -> &Core {
        &self.core
    }

    fn core_mut(&mut self) -> &mut Core {
        &mut self.core
    }

    fn init(core: Core, _flags: Self::Flags) -> (Self, Task<Self::Message>) {
        let app = CleanUsb {
            core,
            page: Page::Devices,
            devices: Vec::new(),
            loading: true,
            wipe_in_progress: None,
            last_result: None,
            error: None,
        };

        let task = Task::perform(
            async { usb::detect_devices() },
            |devices| cosmic::Action::App(Message::DevicesLoaded(devices)),
        );

        (app, task)
    }

    fn update(&mut self, message: Self::Message) -> Task<Self::Message> {
        match message {
            Message::Refresh => {
                self.loading = true;
                self.error = None;
                return Task::perform(
                    async { usb::detect_devices() },
                    |devices| cosmic::Action::App(Message::DevicesLoaded(devices)),
                );
            }

            Message::DevicesLoaded(devices) => {
                self.devices = devices;
                self.loading = false;
                self.page = Page::Devices;
            }

            Message::QuickWipe(device) => {
                return self.start_wipe(device, WipeMode::Quick);
            }

            Message::SecureWipe(device) => {
                return self.start_wipe(device, WipeMode::Secure);
            }

            Message::OpenBrowser(device) => {
                match usb::mount_device(&device) {
                    Ok(mp) => usb::open_in_browser(&mp),
                    Err(e) => self.error = Some(format!("Mount failed: {e}")),
                }
            }

            Message::WipeComplete(result) => {
                self.wipe_in_progress = None;
                self.last_result = Some(*result);
                self.page = Page::Result;
            }

            Message::WipeFailed(err) => {
                self.wipe_in_progress = None;
                self.error = Some(err);
                self.page = Page::Devices;
            }

            Message::BackToDevices => {
                self.last_result = None;
                self.error = None;
                return Task::perform(
                    async { usb::detect_devices() },
                    |devices| cosmic::Action::App(Message::DevicesLoaded(devices)),
                );
            }

            Message::OpenMountPoint(path) => {
                usb::open_in_browser(&path);
            }

        }
        Task::none()
    }

    fn view(&self) -> Element<'_, Self::Message> {
        let content: Element<'_, Self::Message> = match self.page {
            Page::Devices => pages::devices::view(self),
            Page::Wiping => pages::wiping::view(self),
            Page::Result => pages::result::view(self),
        };

        widget::container(content)
            .width(Length::Fill)
            .height(Length::Fill)
            .padding(24)
            .into()
    }
}

impl CleanUsb {
    fn start_wipe(&mut self, device: String, mode: WipeMode) -> Task<Message> {
        let dev_info = self.devices.iter().find(|d| d.path == device);
        let model = dev_info.map(|d| d.model.clone()).unwrap_or_default();

        self.wipe_in_progress = Some(WipeProgress {
            device: device.clone(),
            model,
            mode,
            elapsed_secs: 0,
        });
        self.page = Page::Wiping;

        Task::perform(
            async move {
                match usb::wipe_device(&device, mode) {
                    Ok(result) => Message::WipeComplete(Box::new(result)),
                    Err(e) => Message::WipeFailed(e),
                }
            },
            |msg| cosmic::Action::App(msg),
        )
    }
}
