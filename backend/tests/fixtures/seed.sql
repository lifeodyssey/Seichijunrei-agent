-- Seed data for testcontainer integration tests
-- 5 popular anime + 6 pilgrimage spots

INSERT INTO bangumi (id, title, title_cn, cover_url, points_count) VALUES
  ('262243', '君の名は。', '你的名字。', 'https://img.example.com/yourname.jpg', 3),
  ('120632', '響け！ユーフォニアム', '吹响！悠风号', 'https://img.example.com/eupho.jpg', 2),
  ('227543', 'ヴァイオレット・エヴァーガーデン', '紫罗兰永恒花园', 'https://img.example.com/violet.jpg', 1),
  ('11291', '涼宮ハルヒの憂鬱', '凉宫春日的忧郁', 'https://img.example.com/haruhi.jpg', 0),
  ('18809', 'けいおん！', '轻音少女', 'https://img.example.com/keion.jpg', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO points (id, bangumi_id, name, name_cn, latitude, longitude, image, episode) VALUES
  ('p001', '262243', '須賀神社', '须贺神社', 35.6882, 139.7198, NULL, 1),
  ('p002', '262243', '四ツ谷駅', '四谷站', 35.6868, 139.7300, NULL, 1),
  ('p003', '262243', '新宿御苑', '新宿御苑', 35.6852, 139.7100, NULL, 3),
  ('p004', '120632', '宇治橋', '宇治桥', 34.8892, 135.8071, NULL, 1),
  ('p005', '120632', '京阪宇治駅', '京阪宇治站', 34.8909, 135.8038, NULL, 1),
  ('p006', '227543', '京都市役所', '京都市政府', 35.0116, 135.7681, NULL, 1)
ON CONFLICT (id) DO NOTHING;
