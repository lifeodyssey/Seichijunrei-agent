#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/da06cd8aaa95cd2a12b6ec7af3ccd003366dcdaa88e3c78dfd5578ecf323459a/contract';
import endContract from '../../snapshots/da06cd8aaa95cd2a12b6ec7af3ccd003366dcdaa88e3c78dfd5578ecf323459a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import { AGENT_SERVICE_ACCESS } from './access.ts';
import { BUSINESS_TABLES } from './business-tables.ts';
import { FOREIGN_KEYS, INDEXES, UNIQUE_CONSTRAINTS } from './constraints.ts';
import { NATIVE_TABLES } from './native-tables.ts';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.createSchema({ schema: 'public' }),
      ...[...BUSINESS_TABLES, ...NATIVE_TABLES].map((table) => this.createTable(table)),
      ...UNIQUE_CONSTRAINTS.map((constraint) => this.addUnique(constraint)),
      ...INDEXES.map((index) => this.createIndex(index)),
      ...FOREIGN_KEYS.map((foreignKey) => this.addForeignKey(foreignKey)),
      AGENT_SERVICE_ACCESS];
  }
}

await MigrationCLI.run(import.meta.url, M);
