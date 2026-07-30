#!/usr/bin/env node

import { buildProgram } from '../src/program.js';

const program = buildProgram();
program.parseAsync(process.argv);
