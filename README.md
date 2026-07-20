# Ushi Travel Public API V1

## 必須設定
Cloudflare WorkerのSecretに `CMS_ADMIN_KEY` を登録してください。

## 公開エンドポイント
- `/health`
- `/api/public/cities`
- `/api/public/places?city=paris&category=hotel`
- `/api/public/places/:id-or-canonical-id`
- `/api/public/search-status?q=ホテル名`

## 公開ルール
CMSの `published` または `publish_ready` のデータだけを返します。
AI下書き・要確認・ウシ確認済みは返しません。
