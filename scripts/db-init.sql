CREATE TABLE warehouse (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE inventory (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL,
  stock INTEGER NOT NULL,
  warehouse_id INTEGER REFERENCES warehouse(id),
  price NUMERIC(10,2)
);
INSERT INTO warehouse (id, name) VALUES (1, 'WH-EAST');
INSERT INTO warehouse (id, name) VALUES (2, 'WH-WEST');
INSERT INTO inventory (id, sku, stock, warehouse_id, price) VALUES (1, 'SKU-A', 100, 1, 10.00);
INSERT INTO inventory (id, sku, stock, warehouse_id, price) VALUES (2, 'SKU-B', 50, 1, 20.00);
INSERT INTO inventory (id, sku, stock, warehouse_id, price) VALUES (3, 'SKU-C', 75, 2, 15.00);
