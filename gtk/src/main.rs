//! package-hub — GTK4 + Libadwaita native frontend.
//! Backend logic reused from src-tauri/src/package_manager.rs (single source).

#[path = "../../src-tauri/src/package_manager.rs"]
mod package_manager;

use adw::prelude::*;
use gtk::glib;
use package_manager::{Backend, Package};
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Arc;

const APP_ID: &str = "io.alphingj.packagehub";
const MAX_RESULTS: usize = 60;

#[derive(Clone)]
struct Slot {
    backend: Arc<Backend>,
    op_lock: Arc<std::sync::Mutex<()>>,
}

struct State {
    slots: Vec<Slot>,
    backends: Vec<(String, String)>, // (label, source)
    view: RefCell<String>,
    query: RefCell<String>,
    source: RefCell<Option<String>>,
    category: RefCell<Option<String>>,
    in_flight: RefCell<HashSet<String>>,
    cache: RefCell<HashMap<String, (Vec<Package>, Vec<(String, String)>)>>,
    seq: Cell<u64>,
}

fn validate_query(q: &str) -> Result<(), String> {
    let t = q.trim();
    if t.is_empty() { return Err("Enter a search term".into()); }
    if t.starts_with('-') { return Err("Search term cannot start with '-'".into()); }
    if t.len() > 100 { return Err("Search term too long (max 100)".into()); }
    if !t.chars().all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.' | '+' | ':' | '/')) {
        return Err("Search term contains unsupported characters".into());
    }
    Ok(())
}

fn validate_pkg(p: &str) -> Result<(), String> {
    if p.is_empty() { return Err("Package name is empty".into()); }
    if p.starts_with('-') { return Err("Package name cannot start with '-'".into()); }
    if p.len() > 200 { return Err("Package name too long".into()); }
    // Allow ':' '/' '@' for flatpak refs (app/branch) and arch-qualified names.
    if !p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '_' | '-' | ':' | '/' | '@')) {
        return Err("Package name contains unsupported characters".into());
    }
    Ok(())
}

fn guess_category(name: &str, desc: &str) -> &'static str {
    let h = format!("{name} {desc}").to_lowercase();
    let rules: &[(&[&str], &str)] = &[
        (&["git","gcc","node","python","rust","cargo","golang","jdk","java","sdk","make","cmake","build","compile","dev","code","vim","emacs","ide","lint"], "dev"),
        (&["gimp","inkscape","blender","krita","draw","image","photo","graphic","paint","design","digikam"], "graphics"),
        (&["game","steam","minecraft","lutris","wine","games","tetris"], "games"),
        (&["libreoffice","writer","calc","impress","office","word","excel","document","spreadsheet","presentation"], "office"),
        (&["firefox","chrome","chromium","browser","thunderbird","email","mail","chat","discord","slack","signal","telegram"], "internet"),
        (&["vlc","mpv","player","video","audio","music","sound","spotify","radio","podcast","audacity"], "media"),
        (&["geogebra","scratch","education","learn","teach","kid","student","school","math"], "edu"),
        (&["gnome","kde","settings","manager","system","kernel","driver","firmware","tweak","utility","tool","admin","config"], "system"),
    ];
    for (kws, cat) in rules { if kws.iter().any(|k| h.contains(k)) { return cat; } }
    "system"
}

fn cat_icon(cat: &str) -> &'static str {
    match cat { "dev" => "💻", "graphics" => "🎨", "games" => "🎮", "office" => "📄",
        "internet" => "🌐", "media" => "🎵", "edu" => "🎓", _ => "⚙️" }
}

fn source_label(s: &str) -> String {
    match s { "apt" => "APT", "dnf" => "DNF", "pacman" => "Pacman", "zypper" => "Zypper",
        "flatpak" => "Flatpak", _ => s }.to_string()
}

/// Run blocking work on a thread, deliver result on the GTK main loop.
fn spawn_bg<T, F>(work: F, done: impl FnOnce(T) + 'static)
where T: Send + 'static, F: FnOnce() -> T + Send + 'static {
    let (tx, rx) = async_channel::bounded::<T>(1);
    std::thread::spawn(move || { let _ = tx.send_blocking(work()); });
    glib::MainContext::default().spawn_local(async move {
        if let Ok(v) = rx.recv().await { done(v); }
    });
}

fn main() -> glib::ExitCode {
    let slots: Vec<Slot> = Backend::detect_all().into_iter().map(|b| Slot {
        backend: Arc::new(b), op_lock: Arc::new(std::sync::Mutex::new(())),
    }).collect();
    let backend_infos: Vec<(String, String)> = slots.iter()
        .map(|s| (s.backend.manager.label().to_string(), s.backend.manager.source_id().to_string()))
        .collect();
    let state = Rc::new(State {
        slots, backends: backend_infos, view: RefCell::new("browse".into()),
        query: RefCell::new(String::new()), source: RefCell::new(None),
        category: RefCell::new(None), in_flight: RefCell::new(HashSet::new()),
        cache: RefCell::new(HashMap::new()), seq: Cell::new(0),
    });
    let app = adw::Application::builder().application_id(APP_ID).build();
    app.connect_activate(move |app| build_ui(app, state.clone()));
    app.run()
}

const CSS: &str = r#"
.card { border-radius: 12px; }
.sidebar { background: @sidebar_bg_color; border-right: 1px solid @borders; min-width: 220px; }
.nav-row { border-radius: 8px; padding: 6px 4px; }
.app-row { padding: 10px 12px; border-radius: 12px; }
.dim { opacity: .7; } .small { font-size: .85em; }
"#;

fn build_ui(app: &adw::Application, state: Rc<State>) {
    let provider = gtk::CssProvider::new();
    provider.load_from_data(CSS);
    gtk::style_context_add_provider_for_display(
        &gtk::gdk::Display::default().expect("display"), &provider,
        gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);

    let window = adw::ApplicationWindow::builder()
        .application(app).title("package-hub")
        .default_width(1150).default_height(740).build();
    let toast = adw::ToastOverlay::new();
    let header = adw::HeaderBar::new();
    header.set_title_widget(Some(&adw::WindowTitle::new("package-hub", "Native app store")));
    let theme_btn = gtk::Button::with_label("🌓");
    theme_btn.set_tooltip_text(Some("Toggle dark / light"));
    theme_btn.connect_clicked(|_| {
        let sm = adw::StyleManager::default();
        sm.set_color_scheme(if sm.is_dark() { adw::ColorScheme::ForceLight } else { adw::ColorScheme::ForceDark });
    });
    header.pack_end(&theme_btn);

    let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
    root.append(&header);
    let body = gtk::Box::new(gtk::Orientation::Horizontal, 0);

    // Sidebar (Apple-style: frosted list, section titles).
    let sidebar = gtk::Box::new(gtk::Orientation::Vertical, 6);
    sidebar.add_css_class("sidebar");
    sidebar.set_margin_start(8); sidebar.set_margin_end(8);
    sidebar.set_margin_top(8); sidebar.set_margin_bottom(8);
    let nav = gtk::ListBox::new();
    nav.set_selection_mode(gtk::SelectionMode::Single);
    nav.add_css_class("navigation-sidebar");
    let status = gtk::Label::new(Some(&format!("{} source(s) ready", state.backends.len())));
    status.add_css_class("dim"); status.add_css_class("small");
    status.set_xalign(0.0); status.set_wrap(true);
    let ver = gtk::Label::new(Some("package-hub 0.1.0 · GTK4/Adwaita"));
    ver.add_css_class("dim"); ver.add_css_class("small"); ver.set_xalign(0.0);

    let stack = gtk::Stack::new();
    stack.set_transition_type(gtk::StackTransitionType::Crossfade);
    stack.set_hexpand(true); stack.set_vexpand(true);

    let browse_list = gtk::ListBox::new();
    browse_list.set_selection_mode(gtk::SelectionMode::None);
    browse_list.add_css_class("boxed-list");
    let browse_note = gtk::Label::new(None);
    let browse_err = gtk::Label::new(None);
    browse_err.add_css_class("error"); browse_err.set_wrap(true); browse_err.set_xalign(0.0);
    let browse_page = build_browse(&state, &browse_list, &browse_note, &browse_err, &toast);

    let installed_list = gtk::ListBox::new();
    installed_list.set_selection_mode(gtk::SelectionMode::None);
    installed_list.add_css_class("boxed-list");
    let installed_page = scroll(&installed_list);

    let updates_box = gtk::Box::new(gtk::Orientation::Vertical, 12);
    let updates_page = scroll(&updates_box);

    let settings_page = gtk::Box::new(gtk::Orientation::Vertical, 12);

    stack.add_named(&browse_page, Some("browse"));
    stack.add_named(&installed_page, Some("installed"));
    stack.add_named(&updates_page, Some("updates"));
    stack.add_named(&settings_page, Some("settings"));

    let refresh_holder: Rc<RefCell<Option<Rc<dyn Fn()>>>> = Rc::new(RefCell::new(None));
    let refresh: Rc<dyn Fn()> = {
        let st = state.clone(); let stack = stack.clone();
        let bl = browse_list.clone(); let bn = browse_note.clone(); let be = browse_err.clone();
        let il = installed_list.clone(); let ub = updates_box.clone();
        let toast2 = toast.clone(); let rh = refresh_holder.clone();
        Rc::new(move || {
            let view = st.view.borrow().clone();
            stack.set_visible_child_name(&view);
            let rf = rh.borrow().clone();
            match view.as_str() {
                "browse" => load_browse(st.clone(), bl.clone(), bn.clone(), be.clone(), toast2.clone(), rf),
                "installed" => load_simple(st.clone(), il.clone(), toast2.clone(), rf),
                "updates" => load_updates(st.clone(), ub.clone(), toast2.clone(), rf),
                _ => {}
            }
        })
    };
    *refresh_holder.borrow_mut() = Some(refresh.clone());

    // Nav rows.
    let nav_items: [(&str, &str); 4] = [("📦  Browse", "browse"), ("📥  Installed", "installed"),
        ("🔄  Updates", "updates"), ("⚙️  Settings", "settings")];
    for (label, view) in nav_items {
        let row = gtk::ListBoxRow::new();
        let l = gtk::Label::new(Some(label)); l.set_xalign(0.0); l.add_css_class("nav-row");
        row.set_child(Some(&l)); row.set_widget_name(view);
        nav.append(&row);
        if view == "browse" { nav.select_row(Some(&row)); }
    }
    {
        let st = state.clone(); let rf = refresh.clone();
        nav.connect_row_selected(move |_, row| {
            if let Some(r) = row { *st.view.borrow_mut() = r.widget_name().to_string(); rf(); }
        });
    }
    sidebar.append(&nav);
    sidebar.append(&status); sidebar.append(&ver);

    // Settings content (theme + sources + about).
    settings_page.set_margin_start(18); settings_page.set_margin_end(18);
    settings_page.set_margin_top(18); settings_page.set_margin_bottom(18);
    let clamp = adw::Clamp::builder().maximum_size(720).build();
    let sb = gtk::Box::new(gtk::Orientation::Vertical, 12);
    sb.append(&gtk::Label::new(Some("Appearance")));
    let theme_row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    for (label, dark) in [("Follow system", None), ("Light", Some(false)), ("Dark", Some(true))] {
        let b = gtk::Button::with_label(label);
        b.connect_clicked(move |_| {
            let sm = adw::StyleManager::default();
            sm.set_color_scheme(match dark { None => adw::ColorScheme::Default,
                Some(false) => adw::ColorScheme::ForceLight, Some(true) => adw::ColorScheme::ForceDark });
        });
        theme_row.append(&b);
    }
    sb.append(&theme_row);
    sb.append(&gtk::Label::new(Some("Package sources")));
    if state.backends.is_empty() {
        sb.append(&gtk::Label::new(Some("No package managers detected (apt, dnf, pacman, zypper, flatpak)")));
    } else {
        for (label, source) in &state.backends {
            sb.append(&gtk::Label::new(Some(&format!("{label} ({source}) — Available"))));
        }
    }
    let about_btn = gtk::Button::with_label("About package-hub");
    {
        let win = window.clone();
        about_btn.connect_clicked(move |_| {
            let a = adw::AboutWindow::builder().application_name("package-hub")
                .version("0.1.0").developer_name("gj")
                .comments("Native GTK4 app store for apt / dnf / pacman / zypper / Flatpak")
                .license_type(gtk::License::MitX11).build();
            a.set_transient_for(Some(&win)); a.present();
        });
    }
    sb.append(&about_btn);
    clamp.set_child(Some(&sb));
    settings_page.append(&clamp);

    body.append(&sidebar); body.append(&stack);
    root.append(&body);
    toast.set_child(Some(&root));
    window.set_content(Some(&toast));
    if state.backends.is_empty() {
        toast.add_toast(adw::Toast::new("No supported package managers detected"));
    }
    window.present();
    refresh();
}

fn scroll<W: IsA<gtk::Widget>>(w: &W) -> gtk::ScrolledWindow {
    let s = gtk::ScrolledWindow::builder().hscrollbar_policy(gtk::PolicyType::Never).build();
    s.set_child(Some(w)); s.set_hexpand(true); s.set_vexpand(true); s
}

fn clear_list(list: &gtk::ListBox) { while let Some(r) = list.row_at_index(0) { list.remove(&r); } }
fn clear_box(b: &gtk::Box) { let mut c = b.first_child(); while let Some(w) = c { let n = w.next_sibling(); b.remove(&w); c = n; } }
fn notify(toast: &adw::ToastOverlay, msg: &str) { toast.add_toast(adw::Toast::new(msg)); }

fn build_browse(state: &Rc<State>, list: &gtk::ListBox, note: &gtk::Label,
    err: &gtk::Label, toast: &adw::ToastOverlay) -> gtk::Box {
    let page = gtk::Box::new(gtk::Orientation::Vertical, 10);
    page.set_margin_start(18); page.set_margin_end(18);
    page.set_margin_top(18); page.set_margin_bottom(18);
    let title = gtk::Label::new(Some("Browse apps")); title.add_css_class("title-1"); title.set_xalign(0.0);
    let sub = gtk::Label::new(Some("Search, discover, and install software from your configured sources."));
    sub.add_css_class("dim"); sub.set_xalign(0.0); sub.set_wrap(true);
    let clamp = adw::Clamp::builder().maximum_size(860).build();
    let inner = gtk::Box::new(gtk::Orientation::Vertical, 10);
    inner.append(&title); inner.append(&sub);
    let search = gtk::SearchEntry::new();
    search.set_placeholder_text(Some("Search apps (min 2 characters)…"));
    search.set_text(&state.query.borrow());
    inner.append(&search);
    // Source + category dropdowns.
    let filters = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    let mut src_labels = vec!["All sources".to_string()];
    src_labels.extend(state.backends.iter().map(|(l, _)| l.clone()));
    let src_dd = gtk::DropDown::from_strings(&src_labels.iter().map(|s| s.as_str()).collect::<Vec<_>>());
    let cats = ["All", "Development", "Graphics", "Games", "Office", "Internet", "System", "Media", "Education"];
    let cat_dd = gtk::DropDown::from_strings(&cats);
    filters.append(&src_dd); filters.append(&cat_dd);
    inner.append(&filters);
    inner.append(err); inner.append(note);
    let sc = scroll(list); inner.append(&sc);
    clamp.set_child(Some(&inner)); page.append(&clamp);

    let timer: Rc<RefCell<Option<glib::SourceId>>> = Rc::new(RefCell::new(None));
    {
        let st = state.clone(); let (l, n, e, t) = (list.clone(), note.clone(), err.clone(), toast.clone());
        search.connect_search_changed(move |entry| {
            *st.query.borrow_mut() = entry.text().to_string();
            if let Some(id) = timer.borrow_mut().take() { id.remove(); }
            let (st2, l2, n2, e2, t2) = (st.clone(), l.clone(), n.clone(), e.clone(), t.clone());
            *timer.borrow_mut() = Some(glib::timeout_add_local_once(std::time::Duration::from_millis(250), move || {
                load_browse(st2, l2, n2, e2, t2, None);
            }));
        });
    }
    {
        let st = state.clone(); let (l, n, e, t) = (list.clone(), note.clone(), err.clone(), toast.clone());
        let backs = state.backends.clone();
        src_dd.connect_selected_notify(move |dd| {
            let i = dd.selected() as usize;
            *st.source.borrow_mut() = if i == 0 { None } else { backs.get(i - 1).map(|(_, s)| s.clone()) };
            load_browse(st.clone(), l.clone(), n.clone(), e.clone(), t.clone(), None);
        });
    }
    {
        let st = state.clone(); let (l, n, e, t) = (list.clone(), note.clone(), err.clone(), toast.clone());
        let ids = ["", "dev", "graphics", "games", "office", "internet", "system", "media", "edu"];
        cat_dd.connect_selected_notify(move |dd| {
            let id = ids.get(dd.selected() as usize).copied().unwrap_or("");
            *st.category.borrow_mut() = if id.is_empty() { None } else { Some(id.to_string()) };
            load_browse(st.clone(), l.clone(), n.clone(), e.clone(), t.clone(), None);
        });
    }
    page
}

fn query_all(slots: &[Slot], f: impl Fn(&Backend) -> Result<Vec<Package>, String>)
    -> (Vec<Package>, Vec<(String, String)>) {
    let mut results = Vec::new(); let mut errors = Vec::new();
    for slot in slots {
        match f(&slot.backend) {
            Ok(mut v) => results.append(&mut v),
            Err(e) => errors.push((slot.backend.manager.label().to_string(), e)),
        }
    }
    (results, errors)
}

fn load_browse(state: Rc<State>, list: gtk::ListBox, note: gtk::Label, err: gtk::Label,
    toast: adw::ToastOverlay, refresh: Option<Rc<dyn Fn()>>) {
    let q = state.query.borrow().trim().to_string();
    clear_list(&list); note.set_text(""); err.set_text("");
    if q.len() < 2 {
        note.set_text("Type at least 2 characters to search your package sources.");
        return;
    }
    if validate_query(&q).is_err() { note.set_text("Invalid search term."); return; }
    if let Some((results, errors)) = state.cache.borrow().get(&q).cloned() {
        render_search(&state, &list, &note, &err, results, errors, &toast, refresh);
        return;
    }
    note.set_text("Loading…");
    let seq = state.seq.get() + 1; state.seq.set(seq);
    let slots = state.slots.clone(); let q2 = q.clone();
    spawn_bg(move || query_all(&slots, |b| b.search(&q2)), move |(results, errors)| {
        if state.seq.get() != seq { return; }
        if state.cache.borrow().len() > 20 { state.cache.borrow_mut().clear(); }
        state.cache.borrow_mut().insert(q, (results.clone(), errors.clone()));
        render_search(&state, &list, &note, &err, results, errors, &toast, refresh);
    });
}

fn render_search(state: &Rc<State>, list: &gtk::ListBox, note: &gtk::Label, err: &gtk::Label,
    results: Vec<Package>, errors: Vec<(String, String)>, toast: &adw::ToastOverlay,
    refresh: Option<Rc<dyn Fn()>>) {
    if !errors.is_empty() {
        err.set_text(&format!("{} unavailable — {}", errors[0].0, errors[0].1));
    }
    let mut pkgs = results;
    if let Some(s) = state.source.borrow().as_ref() { pkgs.retain(|p| &p.source == s); }
    if let Some(c) = state.category.borrow().as_ref() {
        pkgs.retain(|p| guess_category(&p.name, p.description.as_deref().unwrap_or("")) == c);
    }
    let total = pkgs.len();
    note.set_text(if total == 0 { "No packages found — try a different term, source, or category." }
        else if total > MAX_RESULTS { "" } else { "" });
    if total > MAX_RESULTS {
        note.set_text(&format!("Showing {MAX_RESULTS} of {total} results — refine your search."));
    }
    for pkg in pkgs.into_iter().take(MAX_RESULTS) {
        list.append(&make_row(state, pkg, toast, refresh.clone(), true));
    }
}

fn make_row(state: &Rc<State>, pkg: Package, toast: &adw::ToastOverlay,
    refresh: Option<Rc<dyn Fn()>>, show_desc: bool) -> gtk::ListBoxRow {
    let cat = guess_category(&pkg.name, pkg.description.as_deref().unwrap_or(""));
    let row = gtk::ListBoxRow::new(); row.add_css_class("app-row");
    let h = gtk::Box::new(gtk::Orientation::Horizontal, 10);
    let av = adw::Avatar::new(40, Some(cat_icon(cat)), true);
    let texts = gtk::Box::new(gtk::Orientation::Vertical, 2);
    let name = gtk::Label::new(Some(&pkg.name)); name.set_xalign(0.0); name.add_css_class("heading");
    texts.append(&name);
    let detail = if show_desc { pkg.description.clone().unwrap_or_default() }
        else { format!("{}{}", pkg.version.as_ref().map(|v| format!("v{v}  •  ")).unwrap_or_default(), source_label(&pkg.source)) };
    if !detail.is_empty() {
        let d = gtk::Label::new(Some(&detail)); d.set_xalign(0.0); d.add_css_class("dim");
        d.set_wrap(true); d.set_ellipsize(gtk::pango::EllipsizeMode::End); texts.append(&d);
    }
    let src = gtk::Label::new(Some(&source_label(&pkg.source)));
    src.add_css_class("dim"); src.add_css_class("small"); src.set_xalign(0.0); texts.append(&src);
    texts.set_hexpand(true);
    h.append(&av); h.append(&texts);

    let actions = gtk::Box::new(gtk::Orientation::Horizontal, 6);
    if pkg.update_available {
        let b = gtk::Button::with_label("Update"); b.add_css_class("suggested-action");
        wire_op(b.clone(), state, &pkg, "update", toast, refresh.clone());
        actions.append(&b);
    }
    if pkg.installed {
        let b = gtk::Button::with_label("Remove"); b.add_css_class("destructive-action");
        wire_op(b.clone(), state, &pkg, "remove", toast, refresh.clone());
        actions.append(&b);
    } else {
        let b = gtk::Button::with_label("Install"); b.add_css_class("suggested-action");
        wire_op(b.clone(), state, &pkg, "install", toast, refresh);
        actions.append(&b);
    }
    h.append(&actions);
    row.set_child(Some(&h));
    row
}

fn wire_op(btn: gtk::Button, state: &Rc<State>, pkg: &Package, kind: &'static str,
    toast: &adw::ToastOverlay, refresh: Option<Rc<dyn Fn()>>) {
    let (st, t) = (state.clone(), toast.clone());
    let (source, name) = (pkg.source.clone(), pkg.name.clone());
    btn.connect_clicked(move |btn| {
        run_op(btn.clone(), st.clone(), source.clone(), name.clone(), kind, t.clone(), refresh.clone());
    });
}

/// Privileged op: per-backend lock on worker thread, live log dialog, toast + refresh.
fn run_op(btn: gtk::Button, state: Rc<State>, source: String, name: String, kind: &'static str,
    toast: adw::ToastOverlay, refresh: Option<Rc<dyn Fn()>>) {
    let key = format!("{source}:{name}");
    if state.in_flight.borrow().contains(&key) { return; }
    if let Err(e) = validate_pkg(&name) { notify(&toast, &e); return; }
    let Some(slot) = state.slots.iter().find(|s| s.backend.manager.source_id() == source) else {
        notify(&toast, &format!("backend '{source}' not found")); return;
    };
    state.in_flight.borrow_mut().insert(key.clone());
    let orig = btn.label().map(|s| s.to_string()).unwrap_or_default();
    btn.set_sensitive(false); btn.set_label(&format!("{kind}ing…"));

    // Live log window.
    let win = gtk::Window::builder().title(format!("{kind} {name}")).default_width(560).default_height(320).build();
    if let Some(root) = btn.root() { if let Ok(w) = root.downcast::<gtk::Window>() { win.set_transient_for(Some(&w)); } }
    let tv = gtk::TextView::builder().editable(false).monospace(true).build();
    let sc = scroll(&tv); let vb = gtk::Box::new(gtk::Orientation::Vertical, 0); vb.append(&sc);
    win.set_child(Some(&vb)); win.present();
    let buf = tv.buffer();

    let (ltx, lrx) = async_channel::unbounded::<String>();
    glib::MainContext::default().spawn_local(async move {
        while let Ok(line) = lrx.recv().await {
            let mut end = buf.end_iter(); buf.insert(&mut end, &format!("{line}\n"));
        }
    });

    let (backend, lock) = (slot.backend.clone(), slot.op_lock.clone());
    let (tx, rx) = async_channel::bounded::<Result<(), String>>(1);
    let name2 = name.clone();
    std::thread::spawn(move || {
        let _g = lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut sink = |line: &str| { let _ = ltx.send_blocking(line.to_string()); };
        let r = match kind {
            "install" => backend.install(&name2, &mut sink),
            "remove" => backend.remove(&name2, &mut sink),
            _ => backend.update_package(&name2, &mut sink),
        };
        let _ = tx.send_blocking(r);
    });
    glib::MainContext::default().spawn_local(async move {
        let r = rx.recv().await.unwrap_or_else(|_| Err("task failed".into()));
        state.in_flight.borrow_mut().remove(&key);
        btn.set_sensitive(true); btn.set_label(&orig);
        match r {
            Ok(()) => { notify(&toast, &format!("{name} — {kind} done"));
                state.cache.borrow_mut().clear();
                if let Some(rf) = refresh { rf(); } }
            Err(e) => notify(&toast, &format!("{kind} failed: {e}")),
        }
    });
}

fn load_simple(state: Rc<State>, list: gtk::ListBox, toast: adw::ToastOverlay, refresh: Option<Rc<dyn Fn()>>) {
    clear_list(&list);
    let note_row = gtk::ListBoxRow::new(); note_row.set_child(Some(&gtk::Label::new(Some("Loading…"))));
    list.append(&note_row);
    let slots = state.slots.clone();
    spawn_bg(move || query_all(&slots, |b| b.list_installed()), move |(mut results, errors)| {
        clear_list(&list);
        if !errors.is_empty() { notify(&toast, &format!("{} unavailable", errors[0].0)); }
        results.sort_by(|a, b| a.name.cmp(&b.name));
        if results.is_empty() {
            let r = gtk::ListBoxRow::new(); r.set_child(Some(&gtk::Label::new(Some("Nothing installed yet")))); list.append(&r);
        }
        for pkg in results { list.append(&make_row(&state, pkg, &toast, refresh.clone(), false)); }
    });
}

fn load_updates(state: Rc<State>, box_: gtk::Box, toast: adw::ToastOverlay, refresh: Option<Rc<dyn Fn()>>) {
    clear_box(&box_);
    box_.append(&gtk::Label::new(Some("Checking for updates…")));
    let slots = state.slots.clone();
    spawn_bg(move || query_all(&slots, |b| b.check_updates()), move |(results, errors)| {
        clear_box(&box_);
        if !errors.is_empty() { notify(&toast, &format!("{} unavailable", errors[0].0)); }
        if results.is_empty() { box_.append(&gtk::Label::new(Some("✅ Your system is up to date"))); return; }
        let mut by: HashMap<String, Vec<Package>> = HashMap::new();
        for p in results { by.entry(p.source.clone()).or_default().push(p); }
        for (source, pkgs) in by {
            let head = gtk::Label::new(Some(&format!("{} — {} update(s)", source_label(&source), pkgs.len())));
            head.add_css_class("title-3"); head.set_xalign(0.0); box_.append(&head);
            let list = gtk::ListBox::new(); list.add_css_class("boxed-list");
            list.set_selection_mode(gtk::SelectionMode::None);
            for pkg in &pkgs { list.append(&make_row(&state, pkg.clone(), &toast, refresh.clone(), false)); }
            box_.append(&list);
            let all = gtk::Button::with_label(&format!("Update all {} package(s)", pkgs.len()));
            all.add_css_class("suggested-action");
            {
                let (st, t, rf, src) = (state.clone(), toast.clone(), refresh.clone(), source.clone());
                all.connect_clicked(move |btn| {
                    let key = format!("all:{src}");
                    if st.in_flight.borrow().contains(&key) { return; }
                    let Some(slot) = st.slots.iter().find(|s| s.backend.manager.source_id() == src) else { return; };
                    st.in_flight.borrow_mut().insert(key.clone());
                    btn.set_sensitive(false); btn.set_label("Updating all…");
                    let (backend, lock) = (slot.backend.clone(), slot.op_lock.clone());
                    let (tx, rx) = async_channel::bounded::<Result<(), String>>(1);
                    std::thread::spawn(move || {
                        let _g = lock.lock().unwrap_or_else(|p| p.into_inner());
                        let mut sink = |_: &str| {};
                        let _ = tx.send_blocking(backend.update_all(&mut sink));
                    });
                    let (st2, t2, rf2, b2) = (st.clone(), t.clone(), rf.clone(), btn.clone());
                    glib::MainContext::default().spawn_local(async move {
                        let r = rx.recv().await.unwrap_or_else(|_| Err("task failed".into()));
                        st2.in_flight.borrow_mut().remove(&key); b2.set_sensitive(true);
                        match r { Ok(()) => { notify(&t2, "All updates applied"); st2.cache.borrow_mut().clear(); if let Some(f) = rf2 { f(); } }
                            Err(e) => notify(&t2, &format!("Update failed: {e}")) }
                    });
                });
            }
            box_.append(&all);
        }
    });
}
