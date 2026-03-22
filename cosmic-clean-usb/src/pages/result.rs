use cosmic::iced::Length;
use cosmic::widget;
use cosmic::Element;

use crate::app::{CleanUsb, Message};

pub fn view<'a>(app: &'a CleanUsb) -> Element<'a, Message> {
    let mut content = widget::column()
        .spacing(16)
        .width(Length::Fill);

    if let Some(ref result) = app.last_result {
        content = content.push(widget::text::title3(format!(
            "{} — Ready!",
            result.model
        )));

        // Results table
        let details = widget::column()
            .push(detail_row("Device", &result.device))
            .push(detail_row("Label", &result.label))
            .push(detail_row("Size", &result.size))
            .push(detail_row("USB", &result.usb_version))
            .push(detail_row("Filesystem", "exFAT (GPT)"))
            .push(detail_row("Action", &result.action))
            .push(detail_row("Write Speed", &result.write_speed))
            .push(detail_row("Read Speed", &result.read_speed))
            .push(detail_row("Integrity", &result.integrity))
            .push(detail_row("Mounted at", &result.mount_point))
            .spacing(4);

        content = content.push(
            widget::container(details)
                .class(cosmic::theme::Container::Card)
                .padding(16)
                .width(Length::Fill),
        );

        let mp = result.mount_point.clone();
        let actions = widget::row()
            .push(
                widget::button::suggested("Open in File Browser")
                    .on_press(Message::OpenMountPoint(mp)),
            )
            .push(
                widget::button::standard("Back to Devices")
                    .on_press(Message::BackToDevices),
            )
            .spacing(8);

        content = content.push(actions);

        content = content.push(
            widget::text::caption("Report saved to ~/usb-report.md")
        );
    } else {
        content = content.push(widget::text::body("No result."));
        content = content.push(
            widget::button::standard("Back")
                .on_press(Message::BackToDevices),
        );
    }

    widget::scrollable(content).into()
}

fn detail_row<'a>(label: &'a str, value: &'a str) -> Element<'a, Message> {
    widget::row()
        .push(
            widget::text::body(label)
                .width(Length::Fixed(120.0)),
        )
        .push(widget::text::body(value))
        .spacing(8)
        .into()
}
