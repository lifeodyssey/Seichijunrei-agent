-- Seed data for testcontainer integration tests
-- 5 popular anime + 6 pilgrimage spots

INSERT INTO bangumi (id, title, title_cn, cover_url, city, points_count) VALUES
  ('262243', '君の名は。', '你的名字。', 'https://img.example.com/yourname.jpg', '東京都', 3),
  ('120632', '響け！ユーフォニアム', '吹响！悠风号', 'https://img.example.com/eupho.jpg', '宇治市', 5),
  ('227543', 'ヴァイオレット・エヴァーガーデン', '紫罗兰永恒花园', 'https://img.example.com/violet.jpg', '京都市', 1),
  ('11291', '涼宮ハルヒの憂鬱', '凉宫春日的忧郁', 'https://img.example.com/haruhi.jpg', '西宮市', 2),
  ('18809', 'けいおん！', '轻音少女', 'https://img.example.com/keion.jpg', '京都市', 2),
  ('269235', '天気の子', '天气之子', 'https://img.example.com/tenki.jpg', '東京都', 3),
  ('387120', 'すずめの戸締まり', '铃芽之旅', 'https://img.example.com/suzume.jpg', '宮崎県', 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO points (id, bangumi_id, name, name_cn, latitude, longitude, image, episode) VALUES
  -- 你的名字 (東京)
  ('p001', '262243', '須賀神社', '须贺神社', 35.6882, 139.7198, 'https://img.example.com/suga.jpg', 1),
  ('p002', '262243', '四ツ谷駅', '四谷站', 35.6868, 139.7300, 'https://img.example.com/yotsuya.jpg', 1),
  ('p003', '262243', '新宿御苑', '新宿御苑', 35.6852, 139.7100, 'https://img.example.com/gyoen.jpg', 3),
  -- 響け！ユーフォニアム (宇治)
  ('p004', '120632', '宇治橋', '宇治桥', 34.8892, 135.8071, 'https://img.example.com/ujibashi.jpg', 1),
  ('p005', '120632', '京阪宇治駅', '京阪宇治站', 34.8909, 135.8038, 'https://img.example.com/keihan.jpg', 1),
  ('p006', '120632', '宇治神社', '宇治神社', 34.8920, 135.8100, NULL, 3),
  ('p007', '120632', '大吉山展望台', '大吉山展望台', 34.8950, 135.8120, NULL, 5),
  ('p008', '120632', '平等院', '平等院', 34.8894, 135.8076, NULL, 7),
  -- ヴァイオレット・エヴァーガーデン (京都)
  ('p009', '227543', '京都市役所', '京都市政府', 35.0116, 135.7681, NULL, 1),
  -- 涼宮ハルヒの憂鬱 (西宮)
  ('p010', '11291', '西宮北口駅', '西宫北口站', 34.7440, 135.3600, NULL, 1),
  ('p011', '11291', '甲陽園駅', '甲阳园站', 34.7560, 135.3400, NULL, 3),
  -- けいおん！(京都)
  ('p012', '18809', '旧豊郷小学校', '�的丰�的小学', 35.2200, 136.2300, NULL, 1),
  ('p013', '18809', '修学院駅', '修学院站', 35.0500, 135.7900, NULL, 2),
  -- 天気の子 (東京)
  ('p014', '269235', '田端駅', '田端站', 35.7380, 139.7610, NULL, 1),
  ('p015', '269235', '池袋サンシャイン60', '池袋Sunshine60', 35.7290, 139.7190, NULL, 2),
  ('p016', '269235', '代々木公園', '代代木公园', 35.6710, 139.6950, NULL, 5),
  -- すずめの戸締まり (宮崎)
  ('p017', '387120', '日南海岸', '日南海岸', 31.6300, 131.4100, NULL, 1),
  ('p018', '387120', '宮崎駅', '宫崎站', 31.9130, 131.4230, NULL, 2)
ON CONFLICT (id) DO NOTHING;
