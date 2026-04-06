// Completion scoring.

use crate::model::{ComponentId, Model};
use std::fmt;
use tracing::instrument;

// ── Per-entity scoring helpers ────────────────────────────────────────────────

/// Returns the completion score (0.0, 0.5, or 1.0) for a single component.
fn score_component(id: ComponentId, model: &Model) -> f64 {
    let comp = &model.components[id.0];
    if comp.leaf {
        // Leaf component scoring (spec §5 Per-Entity Completeness):
        //   - No description                          → Incomplete (0.0)
        //   - Has description, ≥1 incomplete port     → Partial   (0.5)
        //   - Has description, all ports complete
        //     (or no ports at all)                    → Complete  (1.0)
        if comp.description.is_empty() {
            0.0
        } else if comp.ports.is_empty()
            || comp
                .ports
                .iter()
                .all(|&pid| score_port(pid.0, model) == 1.0)
        {
            1.0
        } else {
            0.5
        }
    } else if comp.children.is_empty() {
        // Non-leaf, no children yet -> incomplete.
        0.0
    } else {
        let all_complete = comp
            .children
            .iter()
            .all(|&cid| score_component(cid, model) == 1.0);
        if all_complete { 1.0 } else { 0.5 }
    }
}

/// Returns the completion score (0.0, 0.5, or 1.0) for a single port.
fn score_port(idx: usize, model: &Model) -> f64 {
    let port = &model.ports[idx];
    if port.messages.is_empty() {
        // No messages -> incomplete.
        0.0
    } else {
        let all_complete = port
            .messages
            .iter()
            .all(|&mid| !model.messages[mid.0].fields.is_empty());
        if all_complete { 1.0 } else { 0.5 }
    }
}

/// Returns the completion score (0.0, 0.5, or 1.0) for a single connection.
fn score_connection(idx: usize, model: &Model) -> f64 {
    let conn = &model.connections[idx];
    let from_typed = conn.from.port.is_some();
    let to_typed = conn.to.port.is_some();

    if from_typed && to_typed {
        // Both typed -- check protocol match.
        let from_proto = &model.ports[conn.from.port.unwrap().0].protocol;
        let to_proto = &model.ports[conn.to.port.unwrap().0].protocol;
        if !from_proto.is_empty() && !to_proto.is_empty() && from_proto == to_proto {
            1.0
        } else {
            0.5
        }
    } else if from_typed || to_typed {
        // One side typed -> partial.
        0.5
    } else {
        // Both untyped -> incomplete.
        0.0
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

/// Aggregated scoring statistics for one category.
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

    /// Weighted sum: complete x 1.0 + partial x 0.5 + incomplete x 0.0.
    pub fn sum(&self) -> f64 {
        self.complete as f64 + self.partial as f64 * 0.5
    }

    /// Aggregate percentage (sum / total x 100), or 0.0 for empty categories.
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
    /// Port scoring breakdown.
    pub ports: CategoryScore,
    /// Connection scoring breakdown.
    pub connections: CategoryScore,
    /// Message scoring breakdown.
    pub messages: CategoryScore,
}

impl ScoreReport {
    /// Overall weighted sum across all four categories.
    pub fn overall_sum(&self) -> f64 {
        self.components.sum() + self.ports.sum() + self.connections.sum() + self.messages.sum()
    }

    /// Total entity count across all four categories.
    pub fn overall_total(&self) -> usize {
        self.components.total()
            + self.ports.total()
            + self.connections.total()
            + self.messages.total()
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
        self.components.complete
            + self.ports.complete
            + self.connections.complete
            + self.messages.complete
    }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/// Compute the completion [`ScoreReport`] for a resolved [`Model`].
#[instrument(skip(model))]
pub fn score(model: &Model) -> ScoreReport {
    let comp_scores: Vec<f64> = (0..model.components.len())
        .map(|i| score_component(ComponentId(i), model))
        .collect();

    let port_scores: Vec<f64> = (0..model.ports.len())
        .map(|i| score_port(i, model))
        .collect();

    let conn_scores: Vec<f64> = (0..model.connections.len())
        .map(|i| score_connection(i, model))
        .collect();

    let msg_scores: Vec<f64> = (0..model.messages.len())
        .map(|i| score_message(i, model))
        .collect();

    ScoreReport {
        project_name: model.project.name.clone(),
        components: CategoryScore::from_scores(&comp_scores),
        ports: CategoryScore::from_scores(&port_scores),
        connections: CategoryScore::from_scores(&conn_scores),
        messages: CategoryScore::from_scores(&msg_scores),
    }
}

// ── Display ───────────────────────────────────────────────────────────────────

impl fmt::Display for ScoreReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "📊 Completion Report — {}\n", self.project_name)?;
        writeln!(
            f,
            "   - Components:  {}/{} complete  ({:.1}%)",
            self.components.complete,
            self.components.total(),
            self.components.percentage(),
        )?;
        writeln!(
            f,
            "   - Ports:       {}/{} complete  ({:.1}%)",
            self.ports.complete,
            self.ports.total(),
            self.ports.percentage(),
        )?;
        writeln!(
            f,
            "   - Connections: {}/{} complete  ({:.1}%)",
            self.connections.complete,
            self.connections.total(),
            self.connections.percentage(),
        )?;
        writeln!(
            f,
            "   - Messages:    {}/{} complete  ({:.1}%)",
            self.messages.complete,
            self.messages.total(),
            self.messages.percentage(),
        )?;
        writeln!(
            f,
            "   - Overall:     {}/{}           {:.1}%",
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

        // Components: ground-station-pc is incomplete (non-leaf, no children)
        // All others should be complete (leaf with description or non-leaf with complete children)
        assert_eq!(
            report.components.incomplete, 1,
            "drone components incomplete"
        );
        assert!(report.components.total() >= 13, "drone components total");

        // Messages: all should have fields
        assert_eq!(report.messages.incomplete, 0, "drone messages incomplete");

        // Connections: system-level connections with typed endpoints should score 1.0
        // Bare endpoint connections score lower
        assert!(report.connections.total() >= 8, "drone connections total");
    }

    // ── social-media ───────────────────────────────────────────────────────

    #[test]
    fn score_social_media() {
        let raw = parse_dir(&example_dir("social-media")).expect("social-media should parse");
        let (model, _) = resolve(raw).expect("social-media should resolve");
        let report = score(&model);

        // recommendation-engine: non-leaf, no children -> incomplete
        assert!(
            report.components.incomplete >= 1,
            "social-media components incomplete"
        );

        // Messages: all defined messages have fields
        assert_eq!(
            report.messages.incomplete, 0,
            "social-media messages incomplete"
        );
    }

    // ── software-house ─────────────────────────────────────────────────────

    #[test]
    fn score_software_house() {
        let raw = parse_dir(&example_dir("software-house")).expect("software-house should parse");
        let (model, _) = resolve(raw).expect("software-house should resolve");
        let report = score(&model);

        // operations: non-leaf, no children -> incomplete
        assert!(
            report.components.incomplete >= 1,
            "software-house components incomplete"
        );

        // Messages: all defined messages have fields
        assert_eq!(
            report.messages.incomplete, 0,
            "software-house messages incomplete"
        );
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
        assert!(output.contains("Ports:"), "missing Ports line");
        assert!(output.contains("Connections:"), "missing Connections line");
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
              connection "c" {
                from = "a"
                to   = "b"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let report = score(&model);
        // "a" has description, no ports -> 1.0 (Complete)
        // "b" has no description         -> 0.0 (Incomplete)
        assert_eq!(report.components.complete, 1);
        assert_eq!(report.components.partial, 0);
        assert_eq!(report.components.incomplete, 1);
    }

    // ── unit: leaf with description + complete port → 1.0 ──────────────────

    #[test]
    fn leaf_with_description_and_complete_port_scores_1() {
        let src = r#"
            system "s" {
              component "a" {
                description = "has desc"
                leaf = true
                port "p" {
                  protocol = "spi"
                  role = "provider"
                  message "m1" {
                    description = "fully defined"
                    field "x" { type = "uint8" }
                  }
                }
              }
              component "b" { leaf = true }
              connection "c" {
                from = "a:p"
                to   = "b"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let report = score(&model);
        // "a" has description and its only port is complete (all messages have fields) -> 1.0
        // "b" has no description -> 0.0
        assert_eq!(
            report.components.complete, 1,
            "leaf with description and complete port should score 1.0"
        );
    }

    // ── unit: leaf with description + incomplete port → 0.5 ────────────────

    #[test]
    fn leaf_with_description_and_incomplete_port_scores_partial() {
        let src = r#"
            system "s" {
              component "a" {
                description = "has desc"
                leaf = true
                port "p" {
                  role = "provider"
                  message "m1" {
                    description = "no fields"
                  }
                }
              }
              component "b" { leaf = true }
              connection "c" {
                from = "a:p"
                to   = "b"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let report = score(&model);
        // "a" has description but port "p" has a message with no fields -> port incomplete -> 0.5
        assert_eq!(
            report.components.partial, 1,
            "leaf with description and incomplete port should score 0.5"
        );
    }

    // ── unit: non-leaf component scoring ────────────────────────────────────

    #[test]
    fn non_leaf_component_no_children_scores_0() {
        let src = r#"
            system "s" {
              component "a" {
                description = "fully defined leaf"
                leaf = true
              }
              component "parent" {
                leaf = false
              }
              connection "c" {
                from = "a"
                to   = "parent"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let report = score(&model);
        // "a" has description, no ports → Complete (1.0)
        // "parent" is non-leaf with no children → Incomplete (0.0)
        assert_eq!(
            report.components.incomplete, 1,
            "parent has no children -> 0.0"
        );
        assert_eq!(report.components.complete, 1, "a is complete");
    }

    // ── unit: port scoring ───────────────────────────────────────────────────

    #[test]
    fn port_with_incomplete_message_scores_partial() {
        let src = r#"
            system "s" {
              component "a" {
                leaf = true
                port "p" {
                  role = "provider"
                  message "m1" {
                    description = "has fields"
                    field "x" { type = "uint8" }
                  }
                  message "m2" {
                    description = "no fields"
                  }
                }
              }
              component "b" { leaf = true }
              connection "c" {
                from = "a"
                to   = "b"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let report = score(&model);
        // Port "p" has messages but not all complete -> 0.5
        assert_eq!(report.ports.partial, 1);
        assert_eq!(report.ports.complete, 0);
        assert_eq!(report.ports.incomplete, 0);
    }

    // ── unit: connection scoring ──────────────────────────────────────────────

    #[test]
    fn connection_both_typed_matching_protocol() {
        let src = r#"
            system "s" {
              component "a" {
                leaf = true
                port "p1" {
                  protocol = "spi"
                  role = "provider"
                }
              }
              component "b" {
                leaf = true
                port "p2" {
                  protocol = "spi"
                  role = "consumer"
                }
              }
              connection "c" {
                from = "a:p1"
                to   = "b:p2"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let report = score(&model);
        assert_eq!(
            report.connections.complete, 1,
            "both typed, matching protocol -> 1.0"
        );
    }

    #[test]
    fn connection_one_typed_scores_partial() {
        let src = r#"
            system "s" {
              component "a" {
                leaf = true
                port "p1" {
                  protocol = "spi"
                  role = "provider"
                }
              }
              component "b" { leaf = true }
              connection "c" {
                from = "a:p1"
                to   = "b"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let report = score(&model);
        assert_eq!(report.connections.partial, 1, "one typed -> 0.5");
    }

    #[test]
    fn connection_both_untyped_scores_incomplete() {
        let src = r#"
            system "s" {
              component "a" { leaf = true }
              component "b" { leaf = true }
              connection "c" {
                from = "a"
                to   = "b"
              }
            }
        "#;
        let raw = crate::parse::parse_file(src, std::path::Path::new("test.hcl")).unwrap();
        let (model, _) = resolve(raw).unwrap();
        let report = score(&model);
        assert_eq!(report.connections.incomplete, 1, "both untyped -> 0.0");
    }
}
