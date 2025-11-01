// flymd 桌面端：Tauri 2
// 职责：对话框、文件系统、存储、窗口状态、外链打开等插件初始化

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::State;
#[cfg(not(target_os = "android"))]
use tauri::{Manager, Emitter};
// 全局共享：保存通过“打开方式/默认程序”传入且可能早于前端监听的文件路径
#[derive(Default)]
struct PendingOpenPath(std::sync::Mutex<Option<String>>);
use serde::{Deserialize, Serialize};
use sha2::Digest;
use chrono::{DateTime, Utc};
use std::time::Duration;


#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadReq {
  access_key_id: String,
  secret_access_key: String,
  bucket: String,
  #[serde(default)]
  region: Option<String>,
  #[serde(default)]
  endpoint: Option<String>,
  #[serde(default = "UploadReq::default_true")]
  force_path_style: bool,
  #[serde(default = "UploadReq::default_true")]
  acl_public_read: bool,
  #[serde(default)]
  custom_domain: Option<String>,
  key: String,
  #[serde(default)]
  content_type: Option<String>,
  // 前端可传 Uint8Array -> Vec<u8>
  bytes: Vec<u8>,
}

impl UploadReq {
  fn default_true() -> bool { true }
}

#[derive(Debug, Serialize)]
struct UploadResp {
  key: String,
  public_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresignReq {
  access_key_id: String,
  secret_access_key: String,
  bucket: String,
  #[serde(default)]
  region: Option<String>,
  #[serde(default)]
  endpoint: Option<String>,
  #[serde(default)]
  force_path_style: bool,
  #[serde(default)]
  custom_domain: Option<String>,
  key: String,
  #[serde(default)]
  expires: Option<u32>,
}

#[derive(Debug, Serialize)]
struct PresignResp {
  put_url: String,
  public_url: String,
}

#[tauri::command]
async fn upload_to_s3(req: UploadReq) -> Result<UploadResp, String> {
  // 使用 AWS SDK for Rust 直传，行为与 PicList（SDK）一致；仅构建机需工具链，用户零依赖。
  use aws_sdk_s3 as s3;
  use aws_config::meta::region::RegionProviderChain;
  use s3::config::Region;
  use s3::types::ObjectCannedAcl;
  use s3::primitives::ByteStream;

  let region_str = req.region.clone().unwrap_or_else(|| "us-east-1".to_string());
  let region = Region::new(region_str.clone());
  let region_provider = RegionProviderChain::first_try(region.clone());
  let base_conf = aws_config::defaults(aws_config::BehaviorVersion::latest())
    .region(region_provider)
    .load()
    .await;

  let creds = s3::config::Credentials::new(
    req.access_key_id.clone(),
    req.secret_access_key.clone(),
    None,
    None,
    "flymd",
  );
  let mut conf_builder = s3::config::Builder::from(&base_conf)
    .credentials_provider(creds)
    .force_path_style(req.force_path_style);
  if let Some(ep) = &req.endpoint { if !ep.trim().is_empty() { conf_builder = conf_builder.endpoint_url(ep.trim()); } }
  let conf = conf_builder.build();
  let client = s3::Client::from_conf(conf);

  let mut put = client
    .put_object()
    .bucket(req.bucket.clone())
    .key(req.key.clone())
    .body(ByteStream::from(req.bytes.clone()));
  if let Some(ct) = &req.content_type { if !ct.is_empty() { put = put.content_type(ct); } }
  if req.acl_public_read { put = put.acl(ObjectCannedAcl::PublicRead); }
  put.send().await.map_err(|e| format!("put_object error: {e}"))?;

  // 生成外链
  let key_enc = percent_encoding::utf8_percent_encode(&req.key, percent_encoding::NON_ALPHANUMERIC).to_string();
  let public_url = if let Some(custom) = &req.custom_domain {
    let base = custom.trim_end_matches('/');
    format!("{}/{}", base, key_enc)
  } else if let Some(ep) = &req.endpoint {
    let ep = ep.trim_end_matches('/');
    if req.force_path_style {
      // path-style: <endpoint>/<bucket>/<key>
      format!("{}/{}/{}", ep, req.bucket, key_enc)
    } else {
      // virtual-host: https://<bucket>.<host>/<key>
      match ep.parse::<url::Url>() {
        Ok(u) => format!("{}://{}.{}{}{}{}{}", u.scheme(), req.bucket, u.host_str().unwrap_or(""), if u.port().is_some() { ":" } else { "" }, u.port().map(|p| p.to_string()).unwrap_or_default(), if u.path() == "/" { "" } else { u.path() }, format!("/{}", key_enc)),
        Err(_) => format!("{}/{}/{}", ep, req.bucket, key_enc),
      }
    }
  } else {
    // 默认 S3 公域名
    if req.force_path_style { format!("https://s3.amazonaws.com/{}/{}", req.bucket, key_enc) } else { format!("https://{}.s3.amazonaws.com/{}", req.bucket, key_enc) }
  };

  Ok(UploadResp { key: req.key, public_url })
}

#[tauri::command]
async fn presign_put(req: PresignReq) -> Result<PresignResp, String> {
  use hmac::{Hmac, Mac};
  use sha2::Sha256;
  use std::time::SystemTime;

  let region_str = req.region.clone().unwrap_or_else(|| "us-east-1".to_string());
  let service = "s3";
  let expires = req.expires.unwrap_or(600);

  // 构建基础 URL 与 CanonicalURI
  let ep = req.endpoint.clone().unwrap_or_else(|| "https://s3.amazonaws.com".to_string());
  let ep_url = ep.parse::<url::Url>().map_err(|e| format!("invalid endpoint: {e}"))?;

  fn aws_uri_encode_segment(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    for &b in seg.as_bytes() {
      let c = b as char;
      let is_unreserved = (b'A'..=b'Z').contains(&b)
        || (b'a'..=b'z').contains(&b)
        || (b'0'..=b'9').contains(&b)
        || c == '-' || c == '_' || c == '.' || c == '~';
      if is_unreserved { out.push(c) } else { out.push('%'); out.push_str(&format!("{:02X}", b)); }
    }
    out
  }
  let key_enc = req.key.split('/').map(aws_uri_encode_segment).collect::<Vec<_>>().join("/");

  let (mut base_url, host_for_sig, canonical_uri) = if req.force_path_style {
    // <endpoint>/<bucket>/<key>
    let mut u = ep_url.clone();
    let mut new_path = u.path().trim_end_matches('/').to_string();
    new_path.push('/'); new_path.push_str(&req.bucket);
    new_path.push('/'); new_path.push_str(&key_enc);
    u.set_path(&new_path);
    let host_sig = u.host_str().unwrap_or("").to_string();
    (u, host_sig, new_path)
  } else {
    // https://<bucket>.<host>/<key>
    let host = format!("{}.{}", req.bucket, ep_url.host_str().unwrap_or(""));
    let u = url::Url::parse(&format!("{}://{}/{}", ep_url.scheme(), host, key_enc))
      .map_err(|e| format!("build url error: {e}"))?;
    (u, host, format!("/{}", key_enc))
  };

  // 构建 X-Amz-* 查询参数（不包含 Signature）
  let sys_now = SystemTime::now();
  let datetime: DateTime<Utc> = sys_now.into();
  let amz_date = datetime.format("%Y%m%dT%H%M%SZ").to_string();
  let date_stamp = datetime.format("%Y%m%d").to_string();
  let scope = format!("{}/{}/{}/aws4_request", date_stamp, region_str, service);

  // Query 编码（RFC3986，空格用 %20）
  fn enc_q(v: &str) -> String {
    let mut out = String::new();
    for &b in v.as_bytes() {
      let c = b as char;
      let unreserved = (b'A'..=b'Z').contains(&b)
        || (b'a'..=b'z').contains(&b)
        || (b'0'..=b'9').contains(&b)
        || c == '-' || c == '_' || c == '.' || c == '~';
      if unreserved { out.push(c) } else { out.push('%'); out.push_str(&format!("{:02X}", b)); }
    }
    out
  }

  let mut query: Vec<(String, String)> = vec![
    ("X-Amz-Algorithm".into(), "AWS4-HMAC-SHA256".into()),
    ("X-Amz-Credential".into(), format!("{}/{}", req.access_key_id, scope)),
    ("X-Amz-Date".into(), amz_date.clone()),
    ("X-Amz-Expires".into(), expires.to_string()),
    ("X-Amz-SignedHeaders".into(), "host".into()),
  ];
  query.sort_by(|a,b| a.0.cmp(&b.0));
  let canonical_query = query.iter().map(|(k,v)| format!("{}={}", enc_q(k), enc_q(v))).collect::<Vec<_>>().join("&");

  // CanonicalHeaders / SignedHeaders / HashedPayload
  let canonical_headers = format!("host:{}\n", host_for_sig);
  let signed_headers = "host";
  let hashed_payload = "UNSIGNED-PAYLOAD";

  // CanonicalRequest
  let canonical_request = format!(
    "PUT\n{}\n{}\n{}\n{}\n{}",
    canonical_uri, canonical_query, canonical_headers, signed_headers, hashed_payload
  );

  // StringToSign
  let string_to_sign = format!(
    "AWS4-HMAC-SHA256\n{}\n{}\n{}",
    amz_date,
    scope,
    hex::encode(sha2::Sha256::digest(canonical_request.as_bytes()))
  );

  // 派生签名密钥
  type HmacSha256 = Hmac<Sha256>;
  fn hmac(key: &[u8], data: &str) -> Vec<u8> { let mut mac = HmacSha256::new_from_slice(key).unwrap(); mac.update(data.as_bytes()); mac.finalize().into_bytes().to_vec() }
  let k_date = hmac(format!("AWS4{}", req.secret_access_key).as_bytes(), &date_stamp);
  let k_region = hmac(&k_date, &region_str);
  let k_service = hmac(&k_region, service);
  let k_signing = hmac(&k_service, "aws4_request");
  let signature = hex::encode(hmac(&k_signing, &string_to_sign));

  // 构造最终 URL（附加 Signature）
  let mut final_q = canonical_query.clone();
  final_q.push_str(&format!("&X-Amz-Signature={}", signature));
  base_url.set_query(Some(&final_q));

  // 生成外链
  let public_url = if let Some(custom) = &req.custom_domain {
    let base = custom.trim_end_matches('/');
    format!("{}/{}", base, key_enc)
  } else if req.force_path_style {
    format!("{}/{}/{}", ep.trim_end_matches('/'), req.bucket, key_enc)
  } else {
    format!("{}://{}.{}{}{}{}{}",
      ep_url.scheme(), req.bucket, ep_url.host_str().unwrap_or(""),
      if ep_url.port().is_some() { ":" } else { "" }, ep_url.port().map(|p| p.to_string()).unwrap_or_default(),
      if ep_url.path() == "/" { "" } else { ep_url.path() },
      format!("/{}", key_enc)
    )
  };

  Ok(PresignResp { put_url: base_url.to_string(), public_url })
}

#[derive(Debug, Deserialize)]
struct XmlHttpReq {
  url: String,
  xml: String,
}

#[tauri::command]
async fn http_xmlrpc_post(req: XmlHttpReq) -> Result<String, String> {
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(20))
    .build()
    .map_err(|e| format!("client error: {e}"))?;
  let res = client
    .post(&req.url)
    .header("Content-Type", "text/xml; charset=UTF-8")
    .header("Accept", "text/xml, */*;q=0.1")
    .header("User-Agent", "flymd-typecho-publisher/0.1")
    .body(req.xml)
    .send()
    .await
    .map_err(|e| format!("send error: {e}"))?;
  let status = res.status();
  let text = res.text().await.map_err(|e| format!("read error: {e}"))?;
  if !status.is_success() {
    return Err(format!("HTTP {}: {}", status.as_u16(), text));
  }
  Ok(text)
}

// 公共函数：创建并运行 Tauri 应用
// 供桌面端 (main.rs) 和移动端 (lib.rs) 共同使用
pub fn run_app() {
  tauri::Builder::default()
    .manage(PendingOpenPath::default())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_http::init())
    .invoke_handler(tauri::generate_handler![
      upload_to_s3,
      presign_put,
      move_to_trash,
      force_remove_path,
      read_text_file_any,
      write_text_file_any,
      get_pending_open_path,
      http_xmlrpc_post,
      check_update,
      download_file,
      run_installer,
      // Android SAF 命令
      android_pick_document,
      android_create_document,
      android_read_uri,
      android_write_uri,
      android_persist_uri_permission,
      get_platform
    ])
    .setup(|app| {
      // Windows "打开方式/默认程序" 传入的文件参数处理
      #[cfg(target_os = "windows")]
      {
        use std::env;
        use std::path::PathBuf;
        use std::time::Duration;
        if let Some(win) = app.get_webview_window("main") {
          let args: Vec<PathBuf> = env::args_os().skip(1).map(PathBuf::from).collect();
          if let Some(p) = args.into_iter().find(|p| {
            if !p.exists() { return false; }
            match p.extension().and_then(|s| s.to_str()).map(|s| s.to_ascii_lowercase()) {
              Some(ext) => ext == "md" || ext == "markdown" || ext == "txt" || ext == "pdf",
              None => false,
            }
          }) {
            // 延迟发送事件，确保渲染侧事件监听已注册
            let win_clone = win.clone();
            let path = p.to_string_lossy().to_string();
            // 同时把路径写入共享状态，前端可在启动后主动拉取
            if let Some(state) = app.try_state::<PendingOpenPath>() {
              if let Ok(mut slot) = state.0.lock() { *slot = Some(path.clone()); }
            }
            std::thread::spawn(move || {
              std::thread::sleep(Duration::from_millis(500));
              let _ = win_clone.emit("open-file", path);
              let _ = win_clone.set_focus();
            });
          }
        }
      }
      // 其它初始化逻辑（仅桌面端，移动端无窗口概念）
      #[cfg(not(target_os = "android"))]
      if let Some(win) = app.get_webview_window("main") {
        #[cfg(target_os = "windows")]
        {
          let win_clone = win.clone();
          std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(120));
            #[cfg(not(target_os = "android"))]
            {
              use tauri::window::WindowExt;
              let _ = win_clone.show();
              let _ = win_clone.set_focus();
            }
          });
        }
        #[cfg(not(target_os = "windows"))]
        {
          use tauri::window::WindowExt;
          let _ = win.show();
          let _ = win.set_focus();
        }
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

// 桌面端主入口
// 移动端使用 lib.rs 的 mobile_entry_point
#[cfg(not(mobile))]
fn main() {
  run_app();
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAssetInfo {
  name: String,
  size: u64,
  direct_url: String,
  proxy_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckUpdateResp {
  has_update: bool,
  current: String,
  latest: String,
  release_name: String,
  notes: String,
  html_url: String,
  // Windows 推荐资产
  asset_win: Option<UpdateAssetInfo>,
  // Linux 双资产
  asset_linux_appimage: Option<UpdateAssetInfo>,
  asset_linux_deb: Option<UpdateAssetInfo>,
}

fn norm_ver(v: &str) -> (i64, i64, i64, i64) {
  // 版本比较：major.minor.patch + 权重（fix>无后缀>预发行）
  let s = v.trim().trim_start_matches('v');
  let mut parts = s.splitn(2, '-');
  let core = parts.next().unwrap_or("");
  let suffix = parts.next().unwrap_or("").to_ascii_lowercase();
  let mut nums = core.split('.').take(3).map(|x| x.parse::<i64>().unwrap_or(0)).collect::<Vec<_>>();
  while nums.len() < 3 { nums.push(0); }
  let weight = if suffix.starts_with("fix") { 2 } else if suffix.is_empty() { 1 } else { 0 };
  (nums[0], nums[1], nums[2], weight)
}

fn is_better(a: &(i64,i64,i64,i64), b: &(i64,i64,i64,i64)) -> bool {
  // a > b ?
  a.0 > b.0 || (a.0==b.0 && (a.1 > b.1 || (a.1==b.1 && (a.2 > b.2 || (a.2==b.2 && a.3 > b.3)))))
}

#[derive(Debug, Deserialize)]
struct GhAsset {
  name: String,
  browser_download_url: String,
  size: Option<u64>,
  #[allow(dead_code)]
  content_type: Option<String>,
}
#[derive(Debug, Deserialize)]
struct GhRelease {
  tag_name: String,
  name: Option<String>,
  body: Option<String>,
  draft: bool,
  prerelease: bool,
  html_url: String,
  assets: Vec<GhAsset>,
}

fn gh_proxy_url(raw: &str) -> String {
  // 代理前缀：按“https://gh-proxy.comb/原始URL”拼接
  let prefix = "https://gh-proxy.com/";
  if raw.starts_with(prefix) { raw.to_string() } else { format!("{}{}", prefix, raw) }
}

fn os_arch_tag() -> (&'static str, &'static str) {
  let os = {
    #[cfg(target_os = "windows")] { "windows" }
    #[cfg(target_os = "linux")] { "linux" }
    #[cfg(target_os = "macos")] { "macos" }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))] { "other" }
  };
  let arch = {
    #[cfg(target_arch = "x86_64")] { "x86_64" }
    #[cfg(target_arch = "aarch64")] { "aarch64" }
    #[cfg(target_arch = "x86")] { "x86" }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "x86")))] { "other" }
  };
  (os, arch)
}

fn match_linux_assets(assets: &[GhAsset]) -> (Option<&GhAsset>, Option<&GhAsset>) {
  // 返回 (AppImage, Deb)
  let mut appimage: Option<&GhAsset> = None;
  let mut deb: Option<&GhAsset> = None;
  for a in assets {
    let n = a.name.to_ascii_lowercase();
    // 排除 ARM 相关
    let is_arm = n.contains("arm64") || n.contains("aarch64") || n.contains("armv7");
    if is_arm { continue; }
    if n.ends_with(".appimage") && (n.contains("x86_64") || n.contains("amd64")) {
      if appimage.is_none() { appimage = Some(a); }
    } else if n.ends_with(".deb") && (n.contains("x86_64") || n.contains("amd64")) {
      if deb.is_none() { deb = Some(a); }
    }
  }
  (appimage, deb)
}

fn match_windows_asset(assets: &[GhAsset]) -> Option<&GhAsset> {
  for a in assets {
    let n = a.name.to_ascii_lowercase();
    let is_arm = n.contains("arm64") || n.contains("aarch64") || n.contains("armv7");
    if is_arm { continue; }
    if (n.ends_with(".exe") || n.ends_with(".msi")) && (n.contains("x64") || n.contains("x86_64") || n.contains("amd64")) {
      return Some(a);
    }
  }
  None
}

#[tauri::command]
async fn check_update(_force: Option<bool>, include_prerelease: Option<bool>) -> Result<CheckUpdateResp, String> {
  // 当前版本：与 tauri.conf.json 一致（构建时可由环境注入，这里直接读取 Cargo.toml 同步版本）
  let current = env!("CARGO_PKG_VERSION").to_string();
  let (os_tag, _arch_tag) = os_arch_tag();

  // 节流留空：简单实现始终请求（前端可决定调用频率）

  let url = "https://api.github.com/repos/flyhunterl/flymd/releases";
  let client = reqwest::Client::builder()
    .user_agent("flymd-updater")
    .build()
    .map_err(|e| format!("build client error: {e}"))?;
  let resp = client
    .get(url)
    .header("Accept", "application/vnd.github+json")
    .send().await.map_err(|e| format!("request error: {e}"))?;
  if !resp.status().is_success() { return Err(format!("http status {}", resp.status())); }
  let releases: Vec<GhRelease> = resp.json().await.map_err(|e| format!("json error: {e}"))?;
  let include_pre = include_prerelease.unwrap_or(false);
  let latest = releases.into_iter().find(|r| !r.draft && (include_pre || !r.prerelease))
    .ok_or_else(|| "no release found".to_string())?;

  let latest_tag = latest.tag_name.trim().to_string();
  let n_cur = norm_ver(&current);
  let n_new = norm_ver(&latest_tag);
  let has_update = is_better(&n_new, &n_cur);

  // 组装资产信息
  let mut asset_win = None;
  let mut asset_linux_appimage = None;
  let mut asset_linux_deb = None;
  if os_tag == "windows" {
    if let Some(a) = match_windows_asset(&latest.assets) {
      asset_win = Some(UpdateAssetInfo{
        name: a.name.clone(),
        size: a.size.unwrap_or(0),
        direct_url: a.browser_download_url.clone(),
        proxy_url: gh_proxy_url(&a.browser_download_url),
      });
    }
  } else if os_tag == "linux" {
    let (ai, deb) = match_linux_assets(&latest.assets);
    if let Some(a) = ai {
      asset_linux_appimage = Some(UpdateAssetInfo{
        name: a.name.clone(),
        size: a.size.unwrap_or(0),
        direct_url: a.browser_download_url.clone(),
        proxy_url: gh_proxy_url(&a.browser_download_url),
      });
    }
    if let Some(a) = deb {
      asset_linux_deb = Some(UpdateAssetInfo{
        name: a.name.clone(),
        size: a.size.unwrap_or(0),
        direct_url: a.browser_download_url.clone(),
        proxy_url: gh_proxy_url(&a.browser_download_url),
      });
    }
  }

  let notes = latest.body.unwrap_or_default();
  let name = latest.name.unwrap_or_else(|| latest_tag.clone());

  Ok(CheckUpdateResp{
    has_update,
    current,
    latest: latest_tag,
    release_name: name,
    notes,
    html_url: latest.html_url,
    asset_win,
    asset_linux_appimage,
    asset_linux_deb,
  })
}

#[tauri::command]
#[allow(unused_assignments)]
async fn download_file(url: String, use_proxy: Option<bool>) -> Result<String, String> {
  let client = reqwest::Client::builder()
    .user_agent("flymd-updater")
    .build()
    .map_err(|e| format!("build client error: {e}"))?;

  // 解析文件名
  let (direct, proxy) = {
    let u = url::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    let fname = u
      .path_segments()
      .and_then(|mut s| s.next_back())
      .unwrap_or("download.bin")
      .to_string();
        // 保存到用户下载目录（不可用时回退到临时目录）
    #[cfg(target_os = "windows")]
    let base_download = std::env::var("USERPROFILE")
      .map(|p| std::path::PathBuf::from(p).join("Downloads"))
      .unwrap_or_else(|_| std::env::temp_dir());
    #[cfg(not(target_os = "windows"))]
    let base_download = std::env::var("HOME")
      .map(|p| std::path::PathBuf::from(p).join("Downloads"))
      .unwrap_or_else(|_| std::env::temp_dir());
    let mut path = base_download.clone();
    path.push(&fname);
    let direct = (u, path);
    let proxy = (
      url::Url::parse(&gh_proxy_url(&url)).map_err(|e| format!("invalid proxy url: {e}"))?,
      base_download.join(&fname)
    );
    (direct, proxy)
  };

  // 下载函数
  async fn do_fetch(client: &reqwest::Client, url: &url::Url, save: &std::path::Path) -> Result<(), String> {
    let resp = client.get(url.clone()).send().await.map_err(|e| format!("request error: {e}"))?;
    if !resp.status().is_success() { return Err(format!("http status {}", resp.status())); }
    let mut f = std::fs::File::create(save).map_err(|e| format!("create file error: {e}"))?;
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
      let bytes = chunk.map_err(|e| format!("read chunk error: {e}"))?;
      std::io::Write::write_all(&mut f, &bytes).map_err(|e| format!("write error: {e}"))?;
    }
    Ok(())
  }

  let want_proxy = use_proxy.unwrap_or(false);
  let mut last_err: Option<String> = None;
  if want_proxy {
    if let Err(e) = do_fetch(&client, &proxy.0, &proxy.1).await { last_err = Some(e); } else { return Ok(proxy.1.to_string_lossy().to_string()); }
    // 代理失败 -> 尝试直连
    if let Err(e) = do_fetch(&client, &direct.0, &direct.1).await { last_err = Some(e); } else { return Ok(direct.1.to_string_lossy().to_string()); }
  } else {
    if let Err(e) = do_fetch(&client, &direct.0, &direct.1).await { last_err = Some(e); } else { return Ok(direct.1.to_string_lossy().to_string()); }
    // 直连失败 -> 尝试代理
    if let Err(e) = do_fetch(&client, &proxy.0, &proxy.1).await { last_err = Some(e); } else { return Ok(proxy.1.to_string_lossy().to_string()); }
  }
  Err(last_err.unwrap_or_else(|| "download failed".into()))
}

#[tauri::command]
async fn read_text_file_any(path: String) -> Result<String, String> {
  use std::fs::File;
  use std::io::Read;
  use std::path::PathBuf;

  let pathbuf = PathBuf::from(path);
  if !pathbuf.exists() {
    return Err("path not found".into());
  }

  // 后台线程读取，避免阻塞异步运行时
  let res = tauri::async_runtime::spawn_blocking(move || {
    let mut f = File::open(&pathbuf).map_err(|e| format!("open error: {e}"))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| format!("read error: {e}"))?;
    let s = String::from_utf8_lossy(&buf).to_string();
    Ok::<String, String>(s)
  })
  .await
  .map_err(|e| format!("join error: {e}"))?;

  res
}

#[tauri::command]
async fn write_text_file_any(path: String, content: String) -> Result<(), String> {
  use std::fs;
  use std::path::PathBuf;

  let pathbuf = PathBuf::from(path);
  // 后台线程写入，避免阻塞异步执行器
  tauri::async_runtime::spawn_blocking(move || {
    if let Some(parent) = pathbuf.parent() {
      fs::create_dir_all(parent).map_err(|e| format!("create_dir_all error: {e}"))?;
    }
    fs::write(&pathbuf, content.as_bytes()).map_err(|e| format!("write error: {e}"))?;
    Ok::<(), String>(())
  })
  .await
  .map_err(|e| format!("join error: {e}"))??;

  Ok(())
}

// 前端兜底查询：获取并清空待打开路径，避免事件竞态丢失
#[tauri::command]
async fn get_pending_open_path(state: State<'_, PendingOpenPath>) -> Result<Option<String>, ()> {
  if let Ok(mut slot) = state.0.lock() {
    Ok(slot.take())
  } else {
    Ok(None)
  }
}

#[tauri::command]
async fn move_to_trash(path: String) -> Result<(), String> {
  // 使用 trash crate 跨平台移动到回收站
  // Android 不支持回收站，直接删除
  #[cfg(not(target_os = "android"))]
  {
    tauri::async_runtime::spawn_blocking(move || {
      trash::delete(path).map_err(|e| format!("move_to_trash error: {e}"))
    })
    .await
    .map_err(|e| format!("join error: {e}"))??;
    Ok(())
  }

  #[cfg(target_os = "android")]
  {
    // Android 无回收站概念，直接调用 force_remove_path
    force_remove_path(path).await
  }
}

#[tauri::command]
async fn force_remove_path(path: String) -> Result<(), String> {
  use std::fs;
  use std::path::PathBuf;
  let pathbuf = PathBuf::from(path);
  tauri::async_runtime::spawn_blocking(move || {
    if pathbuf.is_dir() {
      fs::remove_dir_all(&pathbuf).map_err(|e| format!("remove_dir_all error: {e}"))
    } else {
      fs::remove_file(&pathbuf).map_err(|e| format!("remove_file error: {e}"))
    }
  })
  .await
  .map_err(|e| format!("join error: {e}"))??;
  Ok(())
}

#[tauri::command]
async fn run_installer(_path: String) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    use std::process::Command;
    // 使用 PowerShell 以管理员权限启动安装程序
    let status = Command::new("powershell")
      .args([
        "-NoProfile",
        "-Command",
        "Start-Process",
        "-FilePath",
        &_path,
        "-Verb",
        "runas",
      ])
      .status()
      .map_err(|e| format!("spawn error: {e}"))?;
    let _ = status; // 忽略返回码，由安装器自行处理
    Ok(())
  }
  #[cfg(not(target_os = "windows"))]
  {
    Err("run_installer only supports Windows".into())
  }
}

// ============ Android SAF 文件操作命令（移动端专用） ============
// 这些命令在 Android 上通过 JNI 调用原生 SAF API
// 桌面版返回错误提示

#[tauri::command]
async fn android_pick_document() -> Result<String, String> {
  #[cfg(target_os = "android")]
  {
    // TODO: 实现 JNI 调用 Intent ACTION_OPEN_DOCUMENT
    // 返回 content:// URI
    Err("android_pick_document: JNI implementation pending".into())
  }
  #[cfg(not(target_os = "android"))]
  {
    Err("android_pick_document only available on Android".into())
  }
}

#[tauri::command]
async fn android_create_document(filename: String, mime_type: String) -> Result<String, String> {
  #[cfg(target_os = "android")]
  {
    // TODO: 实现 JNI 调用 Intent ACTION_CREATE_DOCUMENT
    // 返回 content:// URI
    let _ = filename;
    let _ = mime_type;
    Err("android_create_document: JNI implementation pending".into())
  }
  #[cfg(not(target_os = "android"))]
  {
    Err("android_create_document only available on Android".into())
  }
}

#[tauri::command]
async fn android_read_uri(uri: String) -> Result<String, String> {
  #[cfg(target_os = "android")]
  {
    // TODO: 实现 JNI 调用 ContentResolver.openInputStream
    // 读取 URI 内容并返回文本
    let _ = uri;
    Err("android_read_uri: JNI implementation pending".into())
  }
  #[cfg(not(target_os = "android"))]
  {
    Err("android_read_uri only available on Android".into())
  }
}

#[tauri::command]
async fn android_write_uri(uri: String, content: String) -> Result<(), String> {
  #[cfg(target_os = "android")]
  {
    // TODO: 实现 JNI 调用 ContentResolver.openOutputStream
    // 写入内容到 URI
    let _ = uri;
    let _ = content;
    Err("android_write_uri: JNI implementation pending".into())
  }
  #[cfg(not(target_os = "android"))]
  {
    Err("android_write_uri only available on Android".into())
  }
}

#[tauri::command]
async fn android_persist_uri_permission(uri: String) -> Result<(), String> {
  #[cfg(target_os = "android")]
  {
    // TODO: 实现 JNI 调用 takePersistableUriPermission
    // 持久化 URI 访问权限
    let _ = uri;
    Err("android_persist_uri_permission: JNI implementation pending".into())
  }
  #[cfg(not(target_os = "android"))]
  {
    Err("android_persist_uri_permission only available on Android".into())
  }
}

#[tauri::command]
async fn get_platform() -> Result<String, String> {
  // 返回当前平台标识，前端用于条件分支
  #[cfg(target_os = "android")]
  {
    Ok("android".into())
  }
  #[cfg(target_os = "windows")]
  {
    Ok("windows".into())
  }
  #[cfg(target_os = "linux")]
  {
    Ok("linux".into())
  }
  #[cfg(target_os = "macos")]
  {
    Ok("macos".into())
  }
  #[cfg(not(any(target_os = "android", target_os = "windows", target_os = "linux", target_os = "macos")))]
  {
    Ok("unknown".into())
  }
}