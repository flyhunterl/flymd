// flymd 桌面端：Tauri 2
// 职责：对话框、文件系统、存储、窗口状态、外链打开等插件初始化

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, Emitter};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use chrono::{DateTime, Utc};

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

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .invoke_handler(tauri::generate_handler![upload_to_s3, presign_put])
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
              Some(ext) => ext == "md" || ext == "markdown" || ext == "txt",
              None => false,
            }
          }) {
            // 延迟发送事件，确保渲染侧事件监听已注册
            let win_clone = win.clone();
            let path = p.to_string_lossy().to_string();
            std::thread::spawn(move || {
              std::thread::sleep(Duration::from_millis(500));
              let _ = win_clone.emit("open-file", path);
              let _ = win_clone.set_focus();
            });
          }
        }
      }
      // 其它初始化逻辑
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

