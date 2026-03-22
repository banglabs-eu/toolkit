use cosmic::iced::Length;
use cosmic::widget;
use cosmic::Element;

use crate::app::{CleanUsb, Message};
use crate::usb::WipeMode;

pub fn view<'a>(app: &'a CleanUsb) -> Element<'a, Message> {
    let mut content = widget::column()
        .spacing(16)
        .width(Length::Fill)
        .padding(24);

    if let Some(ref progress) = app.wipe_in_progress {
        let mode_label = match progress.mode {
            WipeMode::Quick => "Quick wipe",
            WipeMode::Secure => "Secure wipe (full zero)",
        };

        content = content
            .push(widget::text::title3(format!(
                "Wiping {}...",
                progress.model
            )))
            .push(widget::text::body(format!(
                "{} — {}",
                mode_label, progress.device
            )))
            .push(widget::text::body(format!(
                "Elapsed: {}s",
                progress.elapsed_secs
            )))
            .push(widget::text::caption(
                "Wiping, partitioning, formatting, verifying integrity, benchmarking..."
            ));
    } else {
        content = content.push(widget::text::body("Preparing..."));
    }

    widget::container(content)
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}
