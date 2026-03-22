mod app;
mod pages;
mod usb;

use app::CleanUsb;

fn main() -> cosmic::iced::Result {
    let settings = cosmic::app::Settings::default()
        .size(cosmic::iced::Size::new(700.0, 600.0));

    cosmic::app::run::<CleanUsb>(settings, ())
}
