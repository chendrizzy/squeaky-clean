import { config } from '../config';
import { printSuccess, printError, printInfo } from '../utils/cli';

export async function emojisCommand(mode: string | undefined): Promise<void> {
  if (!mode) {
    const currentMode = config.getEmojiMode();
    printInfo(`Current emoji mode: ${currentMode}`);
    printInfo(`Usage: squeaky emojis <on|off|minimal>`);
    return;
  }

  if (mode !== 'on' && mode !== 'off' && mode !== 'minimal') {
    printError(`Invalid mode: ${mode}. Please use 'on', 'off', or 'minimal'.`);
    return;
  }

  const currentConfig = config.get();
  const newConfig = {
    ...currentConfig,
    output: {
      ...currentConfig.output,
      emojis: mode,
    },
  };

  config.set(newConfig);

  printSuccess(`Emoji mode set to: ${mode}`);
}
