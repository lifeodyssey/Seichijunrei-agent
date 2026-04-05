<div align="center">

# 聖地巡礼 Seichijunrei

**アニメ聖地の検索・ルート計画を支援する AI エージェント**

[![CI](https://github.com/lifeodyssey/Seichijunrei-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/lifeodyssey/Seichijunrei-agent/actions/workflows/ci.yml)
[![Deploy](https://github.com/lifeodyssey/Seichijunrei-agent/actions/workflows/deploy.yml/badge.svg)](https://github.com/lifeodyssey/Seichijunrei-agent/actions/workflows/deploy.yml)
[![codecov](https://codecov.io/gh/lifeodyssey/Seichijunrei-agent/graph/badge.svg)](https://codecov.io/gh/lifeodyssey/Seichijunrei-agent)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-3776ab.svg)](https://www.python.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000.svg?logo=nextdotjs)](https://nextjs.org)
[![Cloudflare Workers](https://img.shields.io/badge/deploy-Cloudflare_Workers-f38020.svg?logo=cloudflare)](https://developers.cloudflare.com/workers/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e.svg?logo=supabase)](https://supabase.com)
[![GitHub last commit](https://img.shields.io/github/last-commit/lifeodyssey/Seichijunrei-agent)](https://github.com/lifeodyssey/Seichijunrei-agent/commits/main)
[![GitHub stars](https://img.shields.io/github/stars/lifeodyssey/Seichijunrei-agent?style=flat)](https://github.com/lifeodyssey/Seichijunrei-agent)

[**ライブデモ**](https://seichijunrei.zhenjia.org) | [アーキテクチャ](docs/ARCHITECTURE.md) | [デプロイ](DEPLOYMENT.md)

[English](README.md) | [日本語](README.ja.md) | [中文](README.zh.md)

</div>

---

アニメのタイトルや場所を自然言語で伝えるだけで、実在する聖地巡礼スポットを検索し、地図上に表示し、巡回ルートを計画します。すべて一回の会話で完結します。

## 仕組み

```
ユーザー入力 → ReActPlannerAgent（LLM → 構造化された ExecutionPlan）
                        ↓
               ExecutorAgent（決定的なツール実行）
                 ├── resolve_anime  → DB優先のタイトル検索; ミス時は Bangumi.tv API
                 ├── search_bangumi → パラメータ化 SQL → Supabase ポイント
                 ├── search_nearby  → PostGIS 地理検索
                 ├── plan_route     → 最近傍法によるルート最適化
                 └── answer_question → 静的 FAQ
```

LLM を呼ぶのはプランナーだけです。エグゼキューターは完全に決定的で、実行中に LLM を使いません。

`resolve_anime` は自己進化型です。未知のタイトルを初めてクエリすると、Bangumi.tv からメタデータを取得してDBに保存し、以降のクエリはローカルDBから応答します。

## 主な機能

- **会話型検索** — 日本語・英語・中国語で質問可能、プランナーが意図を判定
- **自己進化するアニメカタログ** — DB優先、Bangumi.tv API によるライトスルー
- **地理検索** — 座標や駅名から近隣の聖地を検索
- **ルート計画** — 最近傍法による巡回順序の最適化
- **ジェネレーティブ UI** — 3カラムレイアウト（チャット + 結果パネル）
- **エッジ認証** — JWT（マジックリンク）と API キー認証を Cloudflare Worker で実施
- **評価ハーネス** — 3言語 × 50件以上のプラン品質テストケース

## クイックスタート

```bash
# Python 依存関係のインストール
uv sync --extra dev

# ローカルでサービスを起動
make serve

# テストの実行
make test              # ユニットテスト
make test-integration  # 安定版統合テスト
make test-all          # ユニット + 統合
make test-eval         # モデル依存の評価テスト（LLMアクセスが必要）
make check             # lint + 型チェック + テスト
```

## データベースマイグレーション

スキーマ変更には Supabase CLI を使用します：

```bash
make db-list           # 適用済みマイグレーション一覧
make db-push-dry       # ドライラン
make db-push           # マイグレーション適用
make db-diff NAME=x    # ローカル変更から diff を生成
```

マイグレーションはアプリ起動時ではなく、デプロイ時の専用ステップで適用してください。

## 環境変数

**必須：**
| 変数名 | 用途 |
|---|---|
| `SUPABASE_DB_URL` | Postgres 接続文字列 |
| `SUPABASE_URL` | Supabase プロジェクト URL |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバーサイド Supabase 認証 |
| `SUPABASE_ANON_KEY` | Worker エッジでの JWT 検証 |
| `ANITABI_API_URL` | Anitabi 聖地データ API |
| `GEMINI_API_KEY` | プランナーエージェント用 LLM |

**オプション：** `SERVICE_HOST`, `SERVICE_PORT`, `OBSERVABILITY_*`, `DEFAULT_AGENT_MODEL`

詳細は [`config/settings.py`](config/settings.py) と [`.env.example`](.env.example) を参照してください。

## 使用例

**Python（直接呼び出し）：**
```python
from agents.pipeline import run_pipeline
from infrastructure.supabase.client import SupabaseClient

async def main() -> None:
    async with SupabaseClient(db_url) as db:
        result = await run_pipeline("吹響ユーフォニアムの聖地", db, locale="ja")
        print(result.message)
```

**HTTP（API キー）：**
```bash
curl -X POST https://seichijunrei.zhenjia.org/v1/runtime \
  -H 'Authorization: Bearer sk_your_key_here' \
  -H 'Content-Type: application/json' \
  -d '{"text":"吹響の聖地","locale":"ja"}'
```

**Python クライアント：**
```python
from clients.python.seichijunrei_client import SeichijunreiClient

client = SeichijunreiClient(api_key="sk_your_key_here")
result = client.search("Hibike Euphonium locations", locale="en")
```

## プロジェクト構成

```text
agents/          プランナー、エグゼキューター、リトリーバー、SQLエージェント
application/     ユースケースと抽象ポート
clients/         Python 同期/非同期クライアント
config/          環境設定とランタイム設定
domain/          コアエンティティとドメインエラー
frontend/        Next.js 静的エクスポート（3カラム・ライトテーマ）
infrastructure/  Supabase クライアント、ゲートウェイ、セッション、可観測性
interfaces/      パブリック API ファサード + aiohttp HTTP サービス
worker/          Cloudflare Worker（認証ミドルウェア + アセットルーティング）
tests/           ユニット、統合、評価テスト
tools/           評価 CLI：スコアラー、フィードバックマイナー
```

## ドキュメント

- [アーキテクチャ](docs/ARCHITECTURE.md) — システム設計リファレンス
- [デプロイ](DEPLOYMENT.md) — Cloudflare Workers + Containers デプロイガイド
- [実装計画](docs/superpowers/plans/) — イテレーション履歴（Iter 0-3 + Auth）
- [設計仕様](docs/superpowers/specs/) — プロダクト仕様
