# easter-egg-toggle

## ADDED Requirements

### Requirement: Gate the boot animation/easter-egg (`showBootPristine` and audio playback) behind a configurable flag that defaults to disabled.
The system MUST keep the animation off by default and only execute it when an explicit flag enables fun mode.
#### Scenario: Default configuration
- Given a fresh install with default config
- When the CLI starts
- Then the boot animation code path does not run and no audio player is loaded.
#### Scenario: User opts in
- Given the user sets `funMode` (or equivalent) to true via config/env/flag
- When the CLI starts
- Then the boot animation may trigger per existing probability and behavior.

### Requirement: Provide a turnkey way to re-enable/disable the easter-egg without code changes, documented in config and help output.
The system MUST let users toggle the animation via config/env/CLI flag without editing source and surface how to do so in help/docs.
#### Scenario: Toggle via config file
- Given the user sets the flag to false in the config file
- When running the CLI
- Then the animation remains disabled even if the audio asset is present.
#### Scenario: Toggle via CLI option
- Given the user passes an explicit flag to enable the animation for a session
- When running the CLI
- Then the animation is eligible for that session without persisting the setting.

### Requirement: Ensure disabling the easter-egg removes side effects (audio playback, prompts, delays) and does not affect core cleaning functions.
The system MUST skip loading audio, prompts, and delays when fun mode is off, leaving core cleaning flow unchanged.
#### Scenario: Animation disabled
- Given the flag is false
- When listing or cleaning caches
- Then no additional prompts or delays from the easter-egg appear and operations complete as before.
