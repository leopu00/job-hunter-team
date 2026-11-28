import { loginChatGpt } from '../auth/chatgpt-login.js';

export function registerLoginCommand(program) {
  program.command('login <provider>')
    .description('Sign in to your ChatGPT subscription')
    .action(async (provider) => {
      if (provider !== 'chatgpt') throw new Error('Usage: jht login chatgpt');
      const result = await loginChatGpt();
      process.exitCode = result.status;
    });
}
