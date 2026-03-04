// Completion scoring.

use crate::model::{ComponentId, Model};
use std::fmt;

// ── Per-entity scoring helpers ────────────────────────────────────────────────

/// Returns the completion score (0.0, 0.5, or 1.0) for a single component.
///
/// The score is recursive: a non-leaf component is only "complete" when all of
/// its direct children are themselves complete.
fn score_component(id: ComponentId, model: &Model) -> f64 {
    let comp = &model.components[id.0];
    if comp.leaf {
        // Leaf component: complete if it has a description, partial otherwise.
        if comp.description.is_empty() {
            0.5
        } else {
            1.0
        }
    } else if comp.children.is_empty() {
        // Non-leaf, no children yet → incomplete.
        0.0
    } else {
        let all_complete = comp
            .children
            .iter()
            .all(|&cid| score_component(cid, model) == 1.0);
        if all_complete { 1.0 } else { 0.5 }
    }
}

/// Returns the completion score (0.0, 0.5, or 1.0) for a single interface.
fn score_interface(idx: usize, model: &Model) -> f64 {
    let iface = &model.interfaces[idx];
    if iface.leaf {
        // Leaf interface: complete if it has a description, partial otherwise.
        if iface.description.is_empty() {
            0.5
        } else {
            1.0
        }
    } else if iface.messages.is_empty() {
        // Non-leaf, no messages yet → incomplete.
        0.0
    } else {
        let all_complete = iface
            .messages
            .iter()
            .all(|&mid| !model.messages[mid.0].fields.is_empty());
        if all_complete { 1.0 } else { 0.5 }
    }
}

/// Returns the completion score (0.0 or 1.0) for a single message.
fn score_message(idx: usize, model: &Model) -> f64 {
    if model.messages[idx].fields.is_empty() {
        0.0
    } else {
        1.0
    }
}

// ── Category statistics ───────────────────────────────────────────────────────

/// Aggregated scoring statistics for one category (components, interfaces, or
/// messages).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CategoryScore {
    /// Number of entities that scored 1.0 ("fully complete").
    pub complete: usize,
    /// Number of entities that scored 0.5 ("partial").
    pub partial: usize,
    /// Number of entities that scored 0.0 ("incomplete").
    pub incomplete: usize,
}

impl CategoryScore {
    /// Build a [`CategoryScore`] from a slice of per-entity scores.
    fn from_scores(scores: &[f64]) -> Self {
        let mut s = CategoryScore {
            complete: 0,
            partial: 0,
            incomplete: 0,
        };
        for &v in scores {
            if (v - 1.0).abs() < f64::EPSILON {
                s.complete += 1;
            } else if (v - 0.5).abs() < f64::EPSILON {
                s.partial += 1;
            } else {
                s.incomplete += 1;
            }
        }
        s
    }

    /// Total number of entities in this category.
    pub fn total(&self) -> usize {
        self.complete + self.partial + self.incomplete
    }

    /// Weighted sum: complete × 1.0 + partial × 0.5 + incomplete × 0.0.
    pub fn sum(&self) -> f64 {
        self.complete as f64 + self.partial as f64 * 0.5
    }

    /// Aggregate percentage (sum / total × 100), or 0.0 for empty categories.
    pub fn percentage(&self) -> f64 {
        let n = self.total();
        if n == 0 {
            0.0
        } else {
            self.sum() / n as f64 * 100.0
        }
    }
}

// ── ScoreReport ───────────────────────────────────────────────────────────────

/// Full completion report produced by [`score`].
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScoreReport {
    /// Project name, used in the report header.
    pub project_name: String,
    /// Component scoring breakdown.
    pub components: CategoryScore,
    /// Interface scoring breakdown.
    pub interfaces: CategoryScore,
    /// Message scoring breakdown.
    pub messages: CategoryScore,
}

impl ScoreReport {
    /// Overall weighted sum across all three categories.
    pub fn overall_sum(&self) -> f64 {
        self.components.sum() + self.interfaces.sum() + self.messages.sum()
    }

    /// Total entity count across all three categories.
    pub fn overall_total(&self) -> usize {
        self.components.total() + self.interfaces.total() + self.messages.total()
    }

    /// Overall aggregate percentage.
    pub fn overall_percentage(&self) -> f64 {
        let n = self.overall_total();
        if n == 0 {
            0.0
        } else {
            self.overall_sum() / n as f64 * 100.0
        }
    }

    /// Count of fully-complete entities across all categories.
    pub fn overall_complete(&self) -> usize {
        self.components.complete + self.interfaces.complete + self.messages.complete
    }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/// Compute the completion [`ScoreReport`] for a resolved [`Model`].
pub fn score(model: &Model) -> ScoreReport {
    let comp_scores: Vec<f64> = (0..model.components.len())
        .map(|i| score_component(ComponentId(i), model))
        .collect();

    let iface_scores: Vec<f64> = (0..model.interfaces.len())
        .map(|i| score_interface(i, model))
        .collect();

    let msg_scores: Vec<f64> = (0..model.messages.len())
        .map(|i| score_message(i, model))
        .collect();

    ScoreReport {
        project_name: model.project.name.clone(),
        components: CategoryScore::from_scores(&comp_scores),
        interfaces: CategoryScore::from_scores(&iface_scores),
        messages: CategoryScore::from_scores(&msg_scores),
    }
}

// ── Display ───────────────────────────────────────────────────────────────────

impl fmt::Display for ScoreReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let sep = "───────────────────────────────────";
        writeln!(f, "Completion Report — {}", self.project_name)?;
        writeln!(f, "{sep}")?;
        writeln!(
            f,
            "Components:  {}/{} complete  ({:.1}%)",
            self.components.complete,
            self.components.total(),
            self.components.percentage(),
        )?;
        writeln!(
            f,
            "Interfaces:  {}/{} complete  ({:.1}%)",
            self.interfaces.complete,
            self.interfaces.total(),
            self.interfaces.percentage(),
        )?;
        writeln!(
            f,
            "Messages:    {}/{} complete  ({:.1}%)",
            self.messages.complete,
            self.messages.total(),
            self.messages.percentage(),
        )?;
        writeln!(f, "{sep}")?;
        write!(
            f,
            "Overall:     {}/{}           {:.1}%",
            self.overall_complete(),
            self.overall_total(),
            self.overall_percentage(),
        )
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::parse_dir;
    use crate::resolve::resolve;
    use std::path::PathBuf;

    fn example_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples")
            .join(name)
    }

    // ── drone ──────────────────────────────────────────────────────────────

    #[test]
    fn score_drone() {
        let raw = parse_dir(&example_dir("drone")).expect("drone should parse");
        let (model, _) = resolve(raw).expect("drone should resolve");
        let report = score(&model);

        // Components: 12 complete (1.0), 0 partial, 1 incomplete (ground-station-pc)
        assert_eq!(report.components.complete, 12, "drone components complete");
        assert_eq!(report.components.partial, 0, "drone components partial");
        assert_eq!(
            report.components.incomplete, 1,
            "drone components incomplete"
        );
        assert_eq!(report.components.total(), 13, "drone components total");

        // Interfaces: all 10 are complete
        assert_eq!(report.interfaces.complete, 10, "drone interfaces complete");
        assert_eq!(report.interfaces.partial, 0, "drone interfaces partial");
        assert_eq!(
            report.interfaces.incomplete, 0,
            "drone interfaces incomplete"
        );

        // Messages: all 3 have fields
        assert_eq!(report.messages.complete, 3, "drone messages complete");
        assert_eq!(report.messages.partial, 0, "drone messages partial");
        assert_eq!(report.messages.incomplete, 0, "drone messages incomplete");

        // Overall: 25/26 → ~96.2%
        assert_eq!(report.overall_complete(), 25);
        assert_eq!(report.overall_total(), 26);
        assert!((report.overall_percentage() - 96.2).abs() < 0.1);
    }

    // ── social-media ───────────────────────────────────────────────────────

    #[test]
    fn score_social_media() {
        let raw = parse_dir(&example_dir("social-media")).expect("social-media should parse");
        let (model, _) = resolve(raw).expect("social-media should resolve");
        let report = score(&model);

        // Components: 11 complete, 1 partial (backend), 1 incomplete (recommendation-engine)
        assert_eq!(
            report.components.complete, 11,
            "social-media components complete"
        );
        assert_eq!(
            report.components.partial, 1,
            "social-media components partial"
        );
        assert_eq!(
            report.components.incomplete, 1,
            "social-media components incomplete"
        );
        assert_eq!(
            report.components.total(),
            13,
            "social-media components total"
        );

        // Interfaces: 9 complete, 0 partial, 1 incomplete (push-notify)
        assert_eq!(
            report.interfaces.complete, 9,
            "social-media interfaces complete"
        );
        assert_eq!(
            report.interfaces.partial, 0,
            "social-media interfaces partial"
        );
        assert_eq!(
            report.interfaces.incomplete, 1,
            "social-media interfaces incomplete"
        );
        assert_eq!(
            report.interfaces.total(),
            10,
            "social-media interfaces total"
        );

        // Messages: 3 complete (get-feed, upload-video, ranked-videos)
        assert_eq!(
            report.messages.complete, 3,
            "social-media messages complete"
        );
        assert_eq!(
            report.messages.incomplete, 0,
            "social-media messages incomplete"
        );
        assert_eq!(report.messages.total(), 3, "social-media messages total");
    }

    // ── software-house ─────────────────────────────────────────────────────

    #[test]
    fn score_software_house() {
        let raw = parse_dir(&example_dir("software-house")).expect("software-house should parse");
        let (model, _) = resolve(raw).expect("software-house should resolve");
        let report = score(&model);

        // Components: 11 complete, 0 partial, 1 incomplete (operations)
        assert_eq!(
            report.components.complete, 11,
            "software-house components complete"
        );
        assert_eq!(
            report.components.partial, 0,
            "software-house components partial"
        );
        assert_eq!(
            report.components.incomplete, 1,
            "software-house components incomplete"
        );
        assert_eq!(
            report.components.total(),
            12,
            "software-house components total"
        );

        // Interfaces: 8 complete, all have descriptions or complete messages
        assert_eq!(
            report.interfaces.complete, 8,
            "software-house interfaces complete"
        );
        assert_eq!(
            report.interfaces.partial, 0,
            "software-house interfaces partial"
        );
        assert_eq!(
            report.interfaces.incomplete, 0,
            "software-house interfaces incomplete"
        );

        // Messages: 5 complete (review-request, design-spec, sprint-backlog, bug-ticket, sign-off)
        assert_eq!(
            report.messages.complete, 5,
            "software-house messages complete"
        );
        assert_eq!(
            report.messages.incomplete, 0,
            "software-house messages incomplete"
        );
        assert_eq!(report.messages.total(), 5, "software-house messages total");

        // Overall: 24/25 → 96.0%
        assert_eq!(report.overall_complete(), 24);
        assert_eq!(report.overall_total(), 25);
        assert!((report.overall_percentage() - 96.0).abs() < 0.1);
    }

    // ── display format ─────────────────────────────────────────────────────

    #[test]
    fn score_display_format() {
        let raw = parse_dir(&example_dir("drone")).expect("drone should parse");
        let (model, _) = resolve(raw).expect("drone should resolve");
        let report = score(&model);
        let output = report.to_string();

        assert!(output.contains("Completion Report"), "missing header");
        assert!(output.contains("Components:"), "missing Components line");
        assert!(output.contains("Interfaces:"), "missing Interfaces line");
        assert!(output.contains("Messages:"), "missing Messages line");
        assert!(output.contains("Overall:"), "missing Overall line");
    }

    // ── unit: leaf component scoring ────────────────────────────────────────

    #[test]
    fn leaf_component_with_description_scores_1() {
        let src = r#"
            system "s" {
              component "a" {
                description = "has one"
                leaf = true
              }
              component "b" {
                leaf = true
              }
              interface "i" {
                from = "a"
                to   = "b"
                leaf = true
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let report = score(&model);
        // "a" → 1.0, "b" → 0.5
        assert_eq!(report.components.complete, 1);
        assert_eq!(report.components.partial, 1);
        assert_eq!(report.components.incomplete, 0);
    }

    // ── unit: non-leaf component scoring ────────────────────────────────────

    #[test]
    fn non_leaf_component_no_children_scores_0() {
        let src = r#"
            system "s" {
              component "a" {
                leaf = true
              }
              component "parent" {
                leaf = false
              }
              interface "i" {
                from = "a"
                to   = "parent"
                leaf = true
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let report = score(&model);
        assert_eq!(
            report.components.incomplete, 1,
            "parent has no children → 0.0"
        );
    }

    // ── unit: interface with incomplete message scores 0.5 ──────────────────

    #[test]
    fn interface_with_incomplete_message_scores_partial() {
        let src = r#"
            system "s" {
              component "a" { leaf = true }
              component "b" { leaf = true }
              interface "i" {
                from = "a"
                to   = "b"
                leaf = false
                message "m1" {
                  description = "has fields"
                  field "x" { type = "uint8" }
                }
                message "m2" {
                  description = "no fields"
                }
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let report = score(&model);
        // Interface "i" has messages but not all complete → 0.5
        assert_eq!(report.interfaces.partial, 1);
        assert_eq!(report.interfaces.complete, 0);
        assert_eq!(report.interfaces.incomplete, 0);
    }
}
