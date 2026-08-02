# リトミック回数券 予約システム 設計書 (フェーズ1)

紙の「回数券 + 開講日カレンダー」運用をオンライン化する。
本書はフェーズ1（申込受付 + 先生用管理画面）の設計。

- 作成: 2026-08-02
- 前提: サイト本体は GitHub Pages のまま。API とデータのみ AWS。
- 出典: `中村バイオリン教室_リトミック月謝規定_v1.pdf` / `リトミック回数券.pdf`

---

## 1. 現状の紙運用（オンライン化の対象）

1. 先生が「開講日カレンダー」を紙で配る
2. 保護者が券種（6/7/8回券）を選び、代金を支払う
3. 保護者が回数券に**3ヶ月分の参加予定日**を記入し、「提出用」を提出（「生徒様控え」は手元に残す）
4. 変更・欠席は都度、電話等で連絡

**煩雑さの原因**: 開講日の共有が紙、参加予定日の集計が手作業、控えの管理が二重。

## 2. スコープ

### フェーズ1（本書）
- 開講日カレンダーのWeb公開
- 券種選択 + 参加予定日選択の申込フォーム
- 申込時の自動メール通知（先生宛）と控えメール（保護者宛）
- 先生用管理画面：開講日の登録・編集、申込一覧の閲覧、CSV出力

### フェーズ2以降（本書の対象外・拡張可能な設計にする）
- 保護者による予定日の変更申請
- 振替（1回まで）の自動管理
- 残回数の自動計算
- オンライン決済

### 非スコープ（当面やらない）
- 決済。**代金は従来どおり現金・振込**とする。
- バイオリン／ピアノ教室の予約。将来同じ基盤に載せられる設計にはする。

## 3. アーキテクチャ

```
[GitHub Pages] nakamura-violin.com          ← 既存サイトはそのまま
   ├ /rythmique/booking/     保護者向け申込フォーム（静的）
   └ /rythmique/admin/       先生向け管理画面（静的 + Cognito認証）
        │
        │ HTTPS (CORS: https://nakamura-violin.com のみ許可)
        ↓
[API Gateway (HTTP API)] api.nakamura-violin.com
   ├ 公開エンドポイント    … 開講枠取得 / 申込登録 / 控え表示
   └ 認証エンドポイント    … 管理API（Cognito JWT オーソライザ）
        ↓
[Lambda (Node.js)]  バリデーション / 定員チェック / トークン発行
        ↓
[DynamoDB] violin-booking     ← 個人情報はここだけ。インターネット非公開。
[SES]                          ← 通知メール・控えメール
[Cognito User Pool]            ← 先生アカウント（1〜2名）
```

**個人情報は GitHub リポジトリに一切保存しない。** リポジトリに含まれるのは
フォームのHTML/CSS/JSのみで、予約データはブラウザ → API Gateway → DynamoDB
で完結する。開講日カレンダーもリポジトリのJSONではなくAPI経由で配信する
（先生が管理画面から編集できるようにするため）。

### リージョン
- 全リソース `ap-northeast-1`（東京）
- 例外: 将来 CloudFront を使う場合の ACM 証明書のみ `us-east-1`

## 4. データモデル (DynamoDB シングルテーブル)

テーブル名: `violin-booking`
課金モード: オンデマンド / 保存時暗号化: 有効 / PITR: 有効

| 用途 | PK | SK |
|---|---|---|
| 開講枠 | `SLOT#<YYYY-MM>` | `SLOT#<slotId>` |
| 回数券申込 | `TICKET#<ticketId>` | `META` |
| 参加予定日 | `TICKET#<ticketId>` | `RES#<slotId>` |

GSI1（枠から参加者を引く / 管理画面の日別一覧用）
- GSI1PK = `SLOT#<slotId>` , GSI1SK = `TICKET#<ticketId>`

GSI2（管理画面の申込一覧を新しい順に引く）
- GSI2PK = `TICKET` , GSI2SK = `<createdAt ISO8601>`

### 4.1 開講枠 (Slot)

「開講日 → 時間枠」構造にする。

**枠は年齢で分けない。** 0-2歳/3-5歳は同一の枠に混在し、
「3歳までは前半、4歳からは後半をご予約ください」という**案内のみ**で運用する
（システム上の強制はしない）。年齢区分は回数券側の属性として保持し、
料金の決定にのみ使う。

**1開講日あたり最大2枠。**

| 枠 | 時間 | 位置づけ |
|---|---|---|
| 前半 | 15:30〜16:30 | 基本の枠。常に開設する |
| 後半 | 16:45〜17:45 | 年齢が高い生徒がいる場合のみ開設する |

案内文は「**3歳までは前半、4歳からは後半をご予約ください**」。
ただしシステム上の年齢制限はかけない。

```jsonc
{
  "PK": "SLOT#2026-08",
  "SK": "SLOT#2026-08-02T15:30",
  "slotId": "2026-08-02T15:30",
  "date": "2026-08-02",          // JST・日曜
  "startTime": "15:30",
  "endTime": "16:30",            // 60分 (40分リトミック + 20分相談会)
  "part": "first",               // first（前半） | second（後半）
  "ageHint": "age0_3",           // 案内用の目安ラベル。制限ではない
  "capacity": 15,                // 定員 15名（前半・後半それぞれ）
  "reservedCount": 3,            // 予約済み数。条件付き更新で原子的に増減
  "status": "open",              // open | closed | cancelled
  "counselorAbsent": false,      // true なら育児相談会（平山）なし
  "note": "",
  "venue": "レンタルスペース simasima レインボー店"
}
```

後半枠は既定では作らず、必要になった時点で管理画面から追加する運用。
1日最大30名。

### 開講日の実績（`なかむらバイオリン教室 1.pdf` より）

すべて**日曜日**、月2〜3回の不定期。単純な繰り返しルールでは表現できないため、
管理画面から日付を個別に登録する方式とする（3ヶ月先まで確定する運用に合致）。

| 月 | 開講日 | 備考 |
|---|---|---|
| 2026/08 | 2, 16, 30 | |
| 2026/09 | 6, 13, 27 | 6 は平山不在 |
| 2026/10 | 18, 25 | |
| 2026/11 | 8, 15, 29 | |
| 2026/12 | 6, 20, 27 | |
| 2027/01 | 10, 17 | |
| 2027/02 | 7, 14, 28 | 7 は平山不在 |
| 2027/03 | 7, 14, 28 | 7 は平山不在 |

> 平山不在日（PDF上は赤丸）は `counselorAbsent: true` として登録し、
> カレンダーUI上で「育児相談会はお休みです」と表示する。

- 開講日は**3ヶ月先まで確定する**運用のため、先生が管理画面から月単位で登録する。
- `PK` を月にすることで「2026-08の全枠」を1回のQueryで取得できる。
- 天災等の当日休講は `status: "cancelled"` にする（規定上、振替対象外）。

### 4.2 回数券申込 (Ticket)

```jsonc
{
  "PK": "TICKET#01J8...",         // ULID
  "SK": "META",
  "GSI2PK": "TICKET",
  "GSI2SK": "2026-08-02T14:05:00Z",
  "ticketId": "01J8...",
  "tokenHash": "sha256:...",      // 控えURL用。生トークンは保存しない
  "guardianName": "中村 花子",
  "childName": "中村 太郎",
  "childBirthMonth": "2024-05",
  "email": "...",
  "tel": "...",
  "ageClass": "age0_2",           // age0_2 | age3_5（料金決定に使用）
  "purchaseType": "ticket",       // ticket（回数券） | single（単発）
  "ticketType": 8,                // ticket のとき 6 | 7 | 8。single のときは 1
  "isFirstTime": true,            // 入会金1,000円の要否
  "amount": 14500,                // 13500 + 入会金1000
  "validFrom": "2026-08-01",
  "validTo": "2026-10-31",        // 3ヶ月有効
  "status": "pending",            // pending | confirmed | paid | cancelled
  "makeupUsed": false,            // 振替1回枠の消化フラグ（フェーズ2で使用）
  "photoConsent": true,           // SNS等への掲載可否（規定に記載あり）
  "createdAt": "2026-08-02T14:05:00Z"
}
```

### 4.3 参加予定日 (Reservation)

券種の回数分だけ作られる。

```jsonc
{
  "PK": "TICKET#01J8...",
  "SK": "RES#2026-08-04T10:30#age0_2",
  "GSI1PK": "SLOT#2026-08-04T10:30#age0_2",
  "GSI1SK": "TICKET#01J8...",
  "slotId": "2026-08-04T10:30#age0_2",
  "date": "2026-08-04",
  "status": "scheduled"           // scheduled | attended | absent | makeup
}
```

## 5. 料金表（PDF 準拠 / 要確認）

**確定済み（2026-08-02）**: PDF の内容が正。サイト側の記載（リトミックページ本文・
トップページのカード・`<meta description>`・OGP・JSON-LD・`sitemap.xml`）は
PDF に合わせて修正済み。

入会金: 一律 1,000円

| 対象 | 単発 | 6回券/3ヶ月 | 7回券/3ヶ月 | 8回券/3ヶ月 |
|---|---|---|---|---|
| 0-2歳児 | 2,500円 | 12,500円 | 13,000円 | 13,500円 |
| 3-5歳児 | 3,000円 | 17,000円 | 17,500円 | 18,000円 |

レッスン時間: 60分（40分リトミック + 20分相談会）

金額は Lambda 側の定数として持ち、**クライアントから送られた金額は信用しない**。

## 6. API 仕様

ベース: `https://api.nakamura-violin.com`

### 公開エンドポイント（認証なし）

#### `GET /slots?from=2026-08&to=2026-10&ageClass=age0_2`
開講枠の一覧。**氏名等の個人情報は返さない。** 残席数のみ。

```jsonc
{ "slots": [ {
  "slotId": "...", "date": "2026-08-04", "startTime": "10:30", "endTime": "11:30",
  "ageClass": "age0_2", "status": "open", "remaining": 5, "venue": "..."
} ] }
```

#### `POST /tickets`
回数券の申込。リクエストに `ticketType`, `ageClass`, 保護者情報, `slotIds[]`,
`photoConsent`, CAPTCHAトークンを含む。

**サーバ側バリデーション（規定 PDF より）**
1. `slotIds.length === ticketType`（券種の回数と選択日数が一致。単発は1件）
2. `slotIds` に重複がない
3. 全ての枠が存在し `status === "open"`
4. 全ての枠の日付が `validFrom`〜`validTo`（3ヶ月）の範囲内（単発は該当なし）
5. 各枠が定員未満（`reservedCount < capacity`、定員15名）
6. CAPTCHA 検証を通過

年齢による枠の制限は行わない（案内のみ）。

書き込みは `TransactWriteItems` で以下を1トランザクションにまとめ、
定員超過を原子的に防ぐ。
- Ticket の PutItem
- Reservation × N の PutItem
- Slot × N の UpdateItem（`ADD reservedCount 1` + `ConditionExpression: reservedCount < capacity`）

> DynamoDB のトランザクションは1回あたり100項目まで。最大 8回券 = 1 + 8 + 8 = 17項目なので余裕がある。

成功後、SES で先生宛通知と保護者宛の控えメール（控えURL付き）を送信。

#### `GET /tickets/{ticketId}?token=<raw>`
申込内容の控え表示。`token` は申込時に発行するランダム32文字。
サーバ側は SHA-256 を突き合わせて検証する。**連番IDは使わない。**

### 管理エンドポイント（Cognito JWT 必須）

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/admin/slots?month=2026-08` | 開講枠一覧（予約者名を含む） |
| POST | `/admin/slots` | 開講枠の登録（月まとめ投入も可） |
| PATCH | `/admin/slots/{slotId}` | 定員・時間・status の変更 |
| DELETE | `/admin/slots/{slotId}` | 予約0件のときのみ削除可 |
| GET | `/admin/tickets?status=&from=&to=` | 申込一覧 |
| PATCH | `/admin/tickets/{ticketId}` | 入金確認（status を paid に）等 |
| GET | `/admin/export.csv` | 申込のCSV出力 |

## 7. セキュリティ要件

- CORS は `https://nakamura-violin.com` のみ許可（`*` にしない）
- **AWS の認証情報をフロントJSに置かない。** ブラウザから直接 DynamoDB を叩く構成は採らない
- DynamoDB は保存時暗号化を有効化、PITR を有効化
- Lambda の IAM ロールは対象テーブル・GSI に限定した最小権限
- CloudWatch Logs に氏名・メール・電話番号を出力しない（`ticketId` のみ記録）
- API Gateway にスロットリング（バースト/レート上限）を設定
- 申込フォームに CAPTCHA（hCaptcha 等）を設置していたずら投稿を防ぐ
- 控えURLのトークンは推測不能な32文字ランダム。DBにはハッシュのみ保存
- 管理画面は Cognito User Pool + MFA。先生アカウントのみ
- フォームに個人情報の利用目的を明示し、プライバシーポリシーへリンクする
  （PDF「個人情報の取扱いについて」の内容をWeb化して掲載）
- 写真掲載の可否（`photoConsent`）をフォームで取得する

## 8. 概算コスト

生徒数十人規模の想定（月間リクエスト数千程度）。

| サービス | 想定 |
|---|---|
| Lambda | 無料枠内 |
| API Gateway (HTTP API) | 無料枠 or 数円 |
| DynamoDB (オンデマンド) | 数円〜数十円 |
| SES | 月数百通なら数円 |
| Cognito | 無料枠内（MAU 数名） |
| Route 53 ホストゾーン | 約 0.50 USD/月 |

**月1ドル未満に収まる見込み。** ただし正式には AWS Pricing Calculator で確認すること。
Budgets で予算アラート（例: 1,000円）を必ず設定する。

## 8.5 ページの公開範囲

予約ページは**限定公開**とする。体験・見込みの方が誤って申し込むのを防ぐため、
サイトのナビゲーションからはリンクせず、URLを知っている人だけがアクセスする。

- パス: `/rythmique/r7k2m9x4/`（推測しにくい文字列）
- `<meta name="robots" content="noindex, nofollow, noarchive">` で検索避け
- `sitemap.xml` には**含めない**
- トップページ・リトミックページからは**リンクしない**
- **`robots.txt` に `Disallow` は書かない。** robots.txt は誰でも読めるため、
  隠したいURLを自ら公開することになり逆効果
- ページ冒頭に「はじめての方は無料体験へ」の案内を置き、体験フォームへ誘導する

> これは *security by obscurity* であり、URLが外部に出れば誰でもアクセスできる。
> より強い保護が必要になった場合は、合言葉（パスコード）のサーバ側検証、
> または生徒ごとの個別トークンURLに切り替える。

## 9. 実装順序

1. AWSアカウント初期設定（MFA / IAM Identity Center / Budgets / リージョン）
2. IaC（AWS CDK）でスタック雛形を作成
3. DynamoDB テーブル + GSI
4. Lambda: `GET /slots`
5. 保護者向けカレンダーUI（既存デザインシステムを流用）
6. Lambda: `POST /tickets`（トランザクション・バリデーション）
7. SES 設定（Gmail宛の通知 + 保護者向け控えメール）
8. Cognito + 管理画面（開講枠の登録・編集 → 申込一覧 → CSV出力）
9. 独自ドメイン `api.nakamura-violin.com` の割当（ACM + API Gateway カスタムドメイン）
10. サイト側の料金・年齢区分の記載を統一（本文・カード・meta・JSON-LD）

## 10. 未確定事項

- [x] **料金・年齢区分**: PDF を正として確定。サイト側の記載も修正済み（2026-08-02）
- [x] **定員**: 1枠あたり最大 15名
- [x] **年齢による枠分け**: 行わない。「3歳までは前半 / 4歳からは後半」の案内のみ
- [x] **単発レッスン**: 申込フォームの対象に**含める**
- [x] **時間枠**: 1開講日あたり最大2枠（前半 15:30〜 / 後半 16:45〜）、各定員15名
- [ ] 平山不在日（赤丸）もレッスン自体は開講する、という理解の確認
- [ ] 「使用開始月の前月最終レッスン日まで」の購入締切をシステムで強制するか、警告のみとするか
- [ ] 会場（レンタルスペース）が複数になる可能性の有無
