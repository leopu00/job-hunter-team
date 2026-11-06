use super::*;

    #[test]
    fn every_exit_of_the_chat_script_is_a_code_of_the_catalog_and_the_link_losing_is_its_own() {
        for (code, expected) in [
            (2, "chat_runtime_outdated"),
            (70, "existing_team_runtime_target_changed"),
            (119, "agent_not_at_prompt"),
            (120, "invalid_request"),
            (121, "team_not_running"),
            (122, "agent_not_running"),
            (123, "agent_unavailable"),
            (124, "agent_busy"),
            (125, "agent_stuck"),
            (126, "send_failed"),
            (127, "read_failed"),
            (128, "persist_failed"),
            (129, "chat_runtime_outdated"),
            (130, "composer_has_text"),
            (114, "chat_runtime_outdated"),
            (115, "answer_failed"),
            (116, "not_found"),
            (117, "invalid_choice"),
            (118, "question_closed"),
            (130, "composer_has_text"),
            (255, "tunnel_unavailable"),
            (1, "the_default"),
            (137, "the_default"),
        ] {
            assert_eq!(chat_failure(code, "the_default"), expected, "exit {code}");
        }
    }

    #[test]
    fn an_older_wrapper_that_does_not_know_the_chat_actions_keeps_the_older_path() {
        let answered = |code: i32| ProcessResult {
            code,
            stdout: b"{}".to_vec(),
        };
        assert!(
            matches!(
                wrapper_outcome(answered(0), "read_failed", false),
                Ok(Some(_))
            ),
            "the script ran"
        );
        assert!(
            matches!(
                wrapper_outcome(answered(64), "read_failed", false),
                Ok(None)
            ),
            "64: no chat actions, keep the older path"
        );
        for (code, expected) in [
            (2, "chat_runtime_outdated"),
            (124, "agent_busy"),
            (122, "agent_not_running"),
            (119, "agent_not_at_prompt"),
            (129, "chat_runtime_outdated"),
            (130, "composer_has_text"),
            (1, "read_failed"),
            (255, "tunnel_unavailable"),
        ] {
            assert_eq!(
                wrapper_outcome(answered(code), "read_failed", false)
                    .err()
                    .map(|error| error.code),
                Some(expected),
                "exit {code}"
            );
        }
        for code in [2, 64] {
            assert_eq!(
                wrapper_outcome(answered(code), "read_failed", true)
                    .err()
                    .map(|error| error.code),
                Some("local_chat_wrapper_outdated"),
                "local exit {code}"
            );
        }
    }

    #[test]
    fn local_chat_builds_all_four_checked_python_commands_without_a_wrapper() {
        use crate::existing_team_runtime::ChatOperation;

        let container = "a".repeat(64);
        let command = |operation| {
            local_chat_exec_args(&container, &operation)
                .unwrap()
                .into_iter()
                .map(|part| part.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            command(ChatOperation::Read {
                agent: "capitano",
                cursor: Some("12")
            }),
            [
                "exec",
                "-i",
                container.as_str(),
                "python3",
                "-I",
                "/app/shared/skills/agent_chat.py",
                "read",
                "capitano",
                "12"
            ]
        );
        assert_eq!(
            command(ChatOperation::Send {
                agent: "assistente",
                client_message_id: "id-1"
            })[6..],
            ["send", "assistente", "id-1"]
        );
        assert_eq!(
            command(ChatOperation::Answer {
                agent: "mentor",
                question_id: "aq:mentor:1-a"
            })[6..],
            ["answer", "mentor", "aq:mentor:1-a"]
        );
        assert_eq!(
            command(ChatOperation::Enter {
                agent: "critico",
                message_id: "message-1"
            })[6..],
            ["enter", "critico", "message-1"]
        );
        assert!(local_chat_exec_args(
            &container,
            &ChatOperation::Send {
                agent: "root",
                client_message_id: "id"
            }
        )
        .is_err());
        assert!(local_chat_exec_args(
            &container,
            &ChatOperation::Read {
                agent: "capitano",
                cursor: Some("12x")
            }
        )
        .is_err());
    }
