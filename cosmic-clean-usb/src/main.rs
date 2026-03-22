mod app;
mod backend;
mod pages;
mod usb;

use app::CleanUsb;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--backend") {
        // Privileged mode — invoked via pkexec
        let backend_args: Vec<String> = args.into_iter()
            .skip_while(|a| a != "--backend")
            .skip(1)
            .collect();
        backend::run(&backend_args).map_err(|e| e.into())
    } else {
        // GUI mode — runs as normal user
        let settings = cosmic::app::Settings::default()
            .size(cosmic::iced::Size::new(700.0, 600.0));
        cosmic::app::run::<CleanUsb>(settings, ())?;
        Ok(())
    }
}
