use std::{env, fs};
use zed_extension_api::{self as zed, settings::CommandSettings, LanguageServerId, Result};

const BUNDLE_PATH: &str = "pddl-lsp.cjs";
const BUNDLE_SOURCE: &str = include_str!("../server/dist/pddl-lsp.cjs");

struct PddlExtension;

impl PddlExtension {
    fn ensure_server_bundle(&self, language_server_id: &LanguageServerId) -> Result<String> {
        let bundle_path = env::current_dir()
            .map_err(|e| format!("failed to resolve extension work directory: {e}"))?
            .join(BUNDLE_PATH);

        let should_write = fs::read_to_string(&bundle_path)
            .map(|contents| contents != BUNDLE_SOURCE)
            .unwrap_or(true);

        if should_write {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            fs::write(&bundle_path, BUNDLE_SOURCE)
                .map_err(|e| format!("failed to write bundled PDDL LSP: {e}"))?;
        }

        Ok(bundle_path.to_string_lossy().to_string())
    }
}

impl zed::Extension for PddlExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let lsp_settings = zed::settings::LspSettings::for_worktree("pddl-semantic", worktree)
            .unwrap_or_default();

        if let Some(CommandSettings {
            path: Some(path),
            arguments,
            ..
        }) = lsp_settings.binary
        {
            return Ok(zed::Command {
                command: path,
                args: arguments.unwrap_or_default(),
                env: Default::default(),
            });
        }

        let bundle_path = self.ensure_server_bundle(_language_server_id)?;

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![bundle_path, "--stdio".to_string()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(PddlExtension);
