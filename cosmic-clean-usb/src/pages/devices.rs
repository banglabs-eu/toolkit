use cosmic::iced::alignment::Vertical;
use cosmic::iced::Length;
use cosmic::widget;
use cosmic::Element;

use crate::app::{CleanUsb, Message};

pub fn view<'a>(app: &'a CleanUsb) -> Element<'a, Message> {
    let header = widget::row()
        .push(widget::text::title3("USB Drives"))
        .push(widget::space::horizontal())
        .push(
            widget::button::suggested("Refresh")
                .on_press(Message::Refresh),
        )
        .spacing(8)
        .align_y(Vertical::Center);

    let mut content = widget::column()
        .push(header)
        .spacing(16)
        .width(Length::Fill);

    // Error banner
    if let Some(ref err) = app.error {
        content = content.push(
            widget::container(
                widget::text::body(err.as_str())
            )
            .padding(12)
            .width(Length::Fill)
            .class(cosmic::theme::Container::Card),
        );
    }

    if app.loading {
        content = content.push(
            widget::text::body("Scanning for USB drives...")
        );
    } else if app.devices.is_empty() {
        content = content.push(
            widget::column()
                .push(widget::text::title4("No USB drives detected"))
                .push(widget::text::body("Plug in a USB drive and click Refresh."))
                .spacing(8)
                .padding(24),
        );
    } else {
        for device in &app.devices {
            content = content.push(device_card(device));
        }
    }

    widget::scrollable(content).into()
}

fn device_card<'a>(device: &'a crate::usb::UsbDevice) -> Element<'a, Message> {
    let dev_path = device.path.clone();

    // Device info
    let info = widget::column()
        .push(widget::text::title4(&device.model))
        .push(widget::text::body(format!(
            "{} — {} — {}",
            device.size, device.usb_version, device.path
        )))
        .spacing(4)
        .width(Length::Fill);

    // Partition details
    let mut parts_col = widget::column().spacing(2);
    for part in &device.partitions {
        let mp = part.mountpoint.as_deref().unwrap_or("not mounted");
        parts_col = parts_col.push(
            widget::text::caption(format!(
                "  {} — {} {} [{}] {}",
                part.path, part.size, part.fstype, part.label, mp
            ))
        );
    }

    // Action buttons
    let quick_path = dev_path.clone();
    let secure_path = dev_path.clone();
    let open_path = dev_path.clone();

    let actions = widget::row()
        .push(
            widget::button::suggested("Quick Wipe")
                .on_press(Message::QuickWipe(quick_path)),
        )
        .push(
            widget::button::destructive("Secure Wipe")
                .on_press(Message::SecureWipe(secure_path)),
        )
        .push(
            widget::button::standard("Open")
                .on_press(Message::OpenBrowser(open_path)),
        )
        .spacing(8);

    let card_content = widget::column()
        .push(info)
        .push(parts_col)
        .push(actions)
        .spacing(12)
        .padding(16);

    widget::container(card_content)
        .class(cosmic::theme::Container::Card)
        .width(Length::Fill)
        .into()
}
