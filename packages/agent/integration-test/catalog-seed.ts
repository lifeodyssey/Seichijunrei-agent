import type { NeonQueryFunction } from "@neondatabase/serverless";

export async function seedCatalog(sql: NeonQueryFunction<false, false>) {
  await sql.transaction([
    sql`INSERT INTO bangumi(id,title,points_count) VALUES ('1556','Native Catalog Proof',2)`,
    sql`INSERT INTO points(id,bangumi_id,name,latitude,longitude,episode) VALUES
      ('catalog-south','1556','South Shrine',35,139,1),
      ('catalog-north','1556','North Shrine',35.002,139,2)`,
    sql`INSERT INTO aliases(bangumi_id,alias,alias_normalized,source,priority)
      VALUES ('1556','Native Catalog Proof','native catalog proof','manual',100)`,
  ]);
}
