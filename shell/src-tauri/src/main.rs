// No console window for the installed app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mini_hub_lib::run()
}
