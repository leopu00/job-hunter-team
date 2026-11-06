use super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
pub(super) enum PositionsRequest {
    List {
        #[serde(skip_serializing_if = "Option::is_none")]
        filters: Option<PositionFilters>,
    },
    Detail {
        id: String,
    },
    Facets,
    Stats,
    /// How many positions each role of the pipeline has to work on (the office's piles): five counts, nothing else.
    Piles,
    /// What the globe needs of every position, from `offset` on (see the script's `map`).
    Map {
        #[serde(default)]
        offset: u32,
    },
    Profile,
    /// What each role did per day and instance in a range of days, and the newest events (see the script's `team_activity`).
    #[serde(rename = "team_activity")]
    TeamActivity {
        from: String,
        to: String,
    },
    /// Every event of the team, newest first, each with the position it touched (the script's `team_activity_log`).
    #[serde(rename = "team_activity_log")]
    TeamActivityLog,
    /// The standing orders of the user's board (the script's `directives`), read only.
    Directives,
    /// How the box's push to the website is going (its periodic push's last outcome).
    #[serde(rename = "cloud_sync")]
    CloudSync,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PositionFilters {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) statuses: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) remote_types: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) sources: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) verdicts: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) families: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) countries: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) cities: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) score_bands: Option<Vec<ScoreBand>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) unscored: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) critic_bands: Option<Vec<ScoreBand>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) critic_unscored: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) write_requested: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) scored_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) hide_excluded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) scam: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) q: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) limit: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) offset: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) sort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) dir: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ScoreBand {
    pub(super) lo: f64,
    pub(super) hi: f64,
}

impl PositionFilters {
    pub(super) fn valid_strings(values: &Option<Vec<String>>) -> bool {
        values.as_ref().map_or(true, |values| {
            (1..=32).contains(&values.len())
                && values.iter().all(|value| (1..=80).contains(&value.len()))
        })
    }

    pub(super) fn valid_bands(values: &Option<Vec<ScoreBand>>) -> bool {
        values.as_ref().map_or(true, |values| {
            values.len() <= 32
                && values
                    .iter()
                    .all(|band| band.lo.is_finite() && band.hi.is_finite() && band.lo <= band.hi)
        })
    }

    pub(super) fn valid(&self) -> bool {
        [
            &self.statuses,
            &self.remote_types,
            &self.sources,
            &self.verdicts,
            &self.families,
            &self.countries,
            &self.cities,
        ]
        .into_iter()
        .all(Self::valid_strings)
            && Self::valid_bands(&self.score_bands)
            && Self::valid_bands(&self.critic_bands)
            && self
                .scam
                .as_ref()
                .map_or(true, |value| matches!(value.as_str(), "hide" | "only"))
            && self.q.as_ref().map_or(true, |value| value.len() <= 120)
            && self.limit.map_or(true, |value| (1..=600).contains(&value))
            && self.offset.map_or(true, |value| value <= 100_000)
            && self.sort.as_ref().map_or(true, |value| {
                matches!(
                    value.as_str(),
                    "id" | "score"
                        | "salary"
                        | "monthly"
                        | "last_action_by"
                        | "critic"
                        | "found_at"
                        | "last_action_at"
                        | "status"
                        | "written_at"
                        | "applied_at"
                        | "title"
                        | "company"
                        | "role_family"
                        | "source"
                        | "location"
                        | "remote"
                        | "loc_country"
                        | "loc_city"
                )
            })
            && self
                .dir
                .as_ref()
                .map_or(true, |value| matches!(value.as_str(), "asc" | "desc"))
    }
}

impl PositionsRequest {
    /// The kind of read, as the load-times log names it (one of `runtime_log::POSITIONS_READ_KINDS`).
    pub(super) fn op(&self) -> &'static str {
        crate::runtime_log::POSITIONS_READ_KINDS[match self {
            Self::List { .. } => 0,
            Self::Detail { .. } => 1,
            Self::Facets => 2,
            Self::Stats => 3,
            Self::Map { .. } => 4,
            Self::Profile => 5,
            Self::CloudSync => 6,
            Self::TeamActivity { .. } => 7,
            Self::Directives => 8,
            Self::Piles => 9,
            Self::TeamActivityLog => 10,
        }]
    }

    pub(super) fn valid(&self) -> bool {
        match self {
            Self::List { filters } => filters.as_ref().map_or(true, PositionFilters::valid),
            Self::Detail { id } => {
                (1..=20).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_digit())
            }
            Self::Map { offset } => *offset <= 1_000_000,
            Self::TeamActivity { from, to } => valid_day(from) && valid_day(to) && from <= to,
            Self::Facets | Self::Stats | Self::Piles | Self::Profile | Self::CloudSync | Self::Directives | Self::TeamActivityLog => true,
        }
    }
}

/// A calendar day as the activity range names it: `YYYY-MM-DD`, digits only (the reader checks the date itself).
pub(super) fn valid_day(day: &str) -> bool {
    let bytes = day.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| if index == 4 || index == 7 { *byte == b'-' } else { byte.is_ascii_digit() })
}

pub(super) fn object_or_null(value: Option<&Value>) -> bool {
    value.is_some_and(|value| value.is_null() || value.is_object())
}

pub(super) fn array(value: Option<&Value>) -> bool {
    value.is_some_and(Value::is_array)
}
