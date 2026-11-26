//! Forwarding of browser Sentry envelopes to Sentry.
//!
//! The browser SDK posts every envelope to `/api/sentry` (its `tunnel` option),
//! so ad blockers see a same-origin request rather than one to Sentry's ingest
//! host. This module checks that an envelope names the Sentry project this
//! server reports to, then re-posts the untouched bytes to that project.

use std::sync::OnceLock;

use axum::body::Bytes;
use axum::http::header::CONTENT_TYPE;

/// Ingest host of the Sentry project browser events are forwarded to. Must
/// match the DSN in `web/src/hooks.client.ts`.
const INGEST_HOST: &str = "o4512171156045824.ingest.de.sentry.io";

/// Sentry project id that every forwarded envelope must name in its DSN.
const PROJECT_ID: &str = "4512175383314512";

/// Why an envelope was refused before it reached Sentry.
#[derive(Debug, thiserror::Error)]
pub enum EnvelopeError {
    /// The body is empty, so there is no envelope header to read.
    #[error("envelope has no header line")]
    MissingHeader,
    /// The first line of the envelope is not a JSON object.
    #[error("envelope header is not valid JSON: {0}")]
    InvalidHeader(#[source] serde_json::Error),
    /// The envelope header has no `dsn` string.
    #[error("envelope header has no dsn")]
    MissingDsn,
    /// The `dsn` value is not a URL.
    #[error("envelope dsn is not a valid URL: {0}")]
    InvalidDsn(#[source] url::ParseError),
    /// The DSN points at a Sentry host other than the configured one.
    #[error("envelope dsn host `{0}` is not the configured ingest host")]
    ForeignHost(String),
    /// The DSN names a Sentry project other than the configured one.
    #[error("envelope dsn project `{0}` is not the configured project")]
    ForeignProject(String),
}

/// Checks that the envelope's header (its first line) carries a DSN for the
/// configured Sentry project. The rest of the envelope is not inspected.
pub fn check_envelope(envelope: &[u8]) -> Result<(), EnvelopeError> {
    let header_line = envelope
        .split(|&byte| byte == b'\n')
        .next()
        .filter(|line| !line.is_empty())
        .ok_or(EnvelopeError::MissingHeader)?;
    let header: serde_json::Value =
        serde_json::from_slice(header_line).map_err(EnvelopeError::InvalidHeader)?;
    let dsn = header
        .get("dsn")
        .and_then(serde_json::Value::as_str)
        .ok_or(EnvelopeError::MissingDsn)?;
    let dsn = url::Url::parse(dsn).map_err(EnvelopeError::InvalidDsn)?;

    let host = dsn.host_str().unwrap_or_default();
    if host != INGEST_HOST {
        return Err(EnvelopeError::ForeignHost(host.to_owned()));
    }
    let project = dsn.path().trim_matches('/');
    if project != PROJECT_ID {
        return Err(EnvelopeError::ForeignProject(project.to_owned()));
    }
    Ok(())
}

/// Shared HTTP client, so connections and TLS state are reused across envelopes.
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// Posts the envelope to the configured project's Sentry endpoint and returns
/// the status Sentry answered with (for example 200, or 429 when rate limited).
pub async fn forward(envelope: Bytes) -> Result<reqwest::StatusCode, reqwest::Error> {
    let client = CLIENT.get_or_init(reqwest::Client::new);
    let upstream = format!("https://{INGEST_HOST}/api/{PROJECT_ID}/envelope/");
    let response = client
        .post(upstream)
        .header(CONTENT_TYPE, "application/x-sentry-envelope")
        .body(envelope)
        .send()
        .await?;
    Ok(response.status())
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_DSN: &str = "https://c5757f769377fa9b99d42e5956213cbb@o4512171156045824.ingest.de.sentry.io/4512175383314512";

    fn envelope_with_dsn(dsn: &str) -> Vec<u8> {
        format!("{{\"dsn\":\"{dsn}\"}}\n{{}}\n{{}}").into_bytes()
    }

    #[test]
    fn accepts_envelope_for_configured_project() {
        assert!(check_envelope(&envelope_with_dsn(VALID_DSN)).is_ok());
    }

    #[test]
    fn rejects_empty_body() {
        assert!(matches!(
            check_envelope(b""),
            Err(EnvelopeError::MissingHeader)
        ));
    }

    #[test]
    fn rejects_header_that_is_not_json() {
        assert!(matches!(
            check_envelope(b"not json\n{}"),
            Err(EnvelopeError::InvalidHeader(_))
        ));
    }

    #[test]
    fn rejects_header_without_dsn() {
        assert!(matches!(
            check_envelope(b"{\"event_id\":\"abc\"}\n{}"),
            Err(EnvelopeError::MissingDsn)
        ));
    }

    #[test]
    fn rejects_dsn_that_is_not_a_url() {
        assert!(matches!(
            check_envelope(&envelope_with_dsn("not a dsn")),
            Err(EnvelopeError::InvalidDsn(_))
        ));
    }

    #[test]
    fn rejects_dsn_for_another_host() {
        let dsn = "https://key@o1.ingest.sentry.io/4512175383314512";
        match check_envelope(&envelope_with_dsn(dsn)) {
            Err(EnvelopeError::ForeignHost(host)) => assert_eq!(host, "o1.ingest.sentry.io"),
            other => panic!("expected ForeignHost, got {other:?}"),
        }
    }

    #[test]
    fn rejects_dsn_for_another_project() {
        let dsn = "https://key@o4512171156045824.ingest.de.sentry.io/999";
        match check_envelope(&envelope_with_dsn(dsn)) {
            Err(EnvelopeError::ForeignProject(project)) => assert_eq!(project, "999"),
            other => panic!("expected ForeignProject, got {other:?}"),
        }
    }
}
