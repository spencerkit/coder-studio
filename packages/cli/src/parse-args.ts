export interface CliArgs {
  command?: 'serve' | 'config' | 'stop' | 'help' | 'version';
  configHelp?: boolean;
  port?: number;
  host?: string;
  dataDir?: string;
  password?: string;
  noAuth?: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  let sawServeCommand = false;
  let sawConfigCommand = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case 'serve':
        args.command = 'serve';
        sawServeCommand = true;
        break;

      case 'config':
        args.command = 'config';
        sawConfigCommand = true;
        break;

      case 'stop':
        args.command = 'stop';
        break;

      case 'help':
        if (sawConfigCommand) {
          args.configHelp = true;
          break;
        }
        args.command = 'help';
        break;

      case '--port':
      case '-p': {
        if (sawServeCommand) {
          throw new Error('Host and port must be configured via the config command');
        }
        const portValue = argv[++i];
        if (!portValue) {
          throw new Error('Missing port value');
        }
        const port = parseInt(portValue, 10);
        if (isNaN(port)) {
          throw new Error('Invalid port number');
        }
        args.port = port;
        break;
      }

      case '--host': {
        if (sawServeCommand) {
          throw new Error('Host and port must be configured via the config command');
        }
        const hostValue = argv[++i];
        if (!hostValue) {
          throw new Error('Missing host value');
        }
        args.host = hostValue;
        break;
      }

      case '--data-dir':
      case '-d': {
        const dataDirValue = argv[++i];
        if (!dataDirValue) {
          throw new Error('Missing data-dir value');
        }
        args.dataDir = dataDirValue;
        break;
      }

      case '--password': {
        const passwordValue = argv[++i];
        if (!passwordValue) {
          throw new Error('Missing password value');
        }
        args.password = passwordValue;
        break;
      }

      case '--no-auth':
        args.noAuth = true;
        break;

      case '--help':
      case '-h':
        if (sawConfigCommand) {
          args.configHelp = true;
          break;
        }
        args.command = 'help';
        break;

      case '--version':
      case '-v':
        args.command = 'version';
        break;
    }
  }

  return args;
}
