#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/43e6a56069f5c68b78e9a97be86e8a3ec011c87f1d94be3f40892e2b1929dce9/contract';
import endContract from '../../snapshots/43e6a56069f5c68b78e9a97be86e8a3ec011c87f1d94be3f40892e2b1929dce9/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/da06cd8aaa95cd2a12b6ec7af3ccd003366dcdaa88e3c78dfd5578ecf323459a/contract';
import startContract from '../../snapshots/da06cd8aaa95cd2a12b6ec7af3ccd003366dcdaa88e3c78dfd5578ecf323459a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'agent_admissions',
        column: col('selection_request', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'agent_admissions',
        constraint: 'agent_admissions_selection_input_b6697af9',
        expression: "(kind = 'selection') = (selection_request IS NOT NULL)",
      }),
    ];
  }
}

await MigrationCLI.run(import.meta.url, M);
