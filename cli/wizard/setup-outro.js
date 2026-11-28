export const CHAT_COMMAND = 'jht team chat assistente';
export const WINDOWS_CHAT_COMMAND = "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'); jht team chat assistente";

/** The setup may still be inside the shell that installed JHT, with its old PATH. */
export function setupOutro(message, platform = process.env.JHT_TERMINAL_PLATFORM || process.platform) {
  if (platform !== 'win32') return message;
  return message.includes(CHAT_COMMAND)
    ? message.replaceAll(CHAT_COMMAND, WINDOWS_CHAT_COMMAND)
    : `${message}\n  ${WINDOWS_CHAT_COMMAND}`;
}
