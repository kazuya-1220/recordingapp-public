import { ArrowLeft, Radio, Mic, Share2, Search, FileText, Settings, HelpCircle, Smartphone, Monitor } from 'lucide-react';
import type { ViewState } from '../App';

const sections = [
  {
    icon: Mic,
    title: '録音する',
    items: [
      '「録音」タブをタップして録音画面を開きます',
      '赤い録音ボタンを押すと録音が開始されます',
      '録音中に顧客番号を入力すると、Kintoneから顧問先情報を自動検索します',
      '「参加者を追加」から社内メンバーや社外参加者を選択できます',
      '添付ファイル（PDF・画像）をアップロードすると自動でOCR処理されます',
      '録音を停止すると、文字起こし・整形・AI要約が自動生成されます',
      '完了後、Kintoneに自動で同期されます',
    ],
  },
  {
    icon: Share2,
    title: 'ライブ同期',
    items: [
      '別のデバイスで録音中のセッションにリアルタイム参加できます',
      '「ライブ同期」タブを開き、表示されたセッションIDで接続します',
      '接続すると、顧客情報や添付ファイルがリアルタイムで共有されます',
      'ブラウザで録音を開始し、iOSからライブ同期に参加するのが基本的な使い方です',
      '同期参加者は顧客ルックアップやファイル追加が可能です',
    ],
  },
  {
    icon: Search,
    title: '履歴検索',
    items: [
      '「履歴」タブで過去の録音を一覧表示します',
      'キーワード検索でタイトル・テキスト・要約を横断検索できます',
      '日付範囲フィルターで期間を絞り込めます',
      '「未同期のみ」フィルターでKintone未同期の録音を表示できます',
      '各録音カードから要約の確認・編集・再生成が可能です',
    ],
  },
  {
    icon: FileText,
    title: 'AI要約',
    items: [
      '録音完了時にGemini AIが自動で議事録を生成します',
      '履歴画面から「AI再生成」ボタンで要約を再生成できます（追加指示も可能）',
      '「編集」ボタンで要約を手動編集し、Kintoneに反映できます',
      '議題・内容/決定事項・宿題/アクション・次回予定・ファイル内容の5セクション構成です',
    ],
  },
  {
    icon: Settings,
    title: '設定',
    items: [
      'ライトモード / ダークモードの切り替え',
      '文字サイズの調整（5段階）',
      'ログアウト',
      'ベータフィードバックの送信',
    ],
  },
  {
    icon: Smartphone,
    title: 'iOS版の注意点',
    items: [
      'Safari・Chromeどちらでも利用可能です',
      '録音はブラウザ版で行い、iOSからはライブ同期で参加するのが推奨です',
      'PDFプレビューはシステムビューアで開きます',
      'ポップアップブロックの設定をオフにしてください（ログイン時に必要）',
    ],
  },
];

export function HelpPage({ onViewChange }: { onViewChange: (v: ViewState) => void }) {
  return (
    <div className="mt-4 space-y-5 pb-36 max-w-3xl">
      <div className="flex items-center gap-3">
        <button onClick={() => onViewChange('settings')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-95">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <HelpCircle className="w-5 h-5 text-blue-600" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">使い方ガイド</h2>
      </div>

      {/* Quick start */}
      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Radio className="w-5 h-5 text-blue-600" />
          <h3 className="font-bold text-blue-900 dark:text-blue-300">クイックスタート</h3>
        </div>
        <div className="space-y-2 text-sm text-blue-800 dark:text-blue-300">
          <div className="flex items-start gap-2">
            <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
            <p>「録音」タブで録音を開始</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
            <p>顧客番号を入力してKintoneと連携</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</span>
            <p>参加者を追加、必要に応じてファイルを添付</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">4</span>
            <p>録音停止 → 自動で文字起こし・AI要約・Kintone同期</p>
          </div>
        </div>
      </div>

      {/* Device recommendations */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
        <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
          <Monitor className="w-4 h-4 text-slate-500" />
          推奨デバイス構成
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
            <p className="font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
              <Monitor className="w-3.5 h-3.5" /> ブラウザ（PC/Mac）
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">録音の開始・操作に最適。Chromeを推奨。</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
            <p className="font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
              <Smartphone className="w-3.5 h-3.5" /> iOS（iPhone/iPad）
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">ライブ同期での参加に最適。ファイル追加・閲覧も可能。</p>
          </div>
        </div>
      </div>

      {/* Detailed sections */}
      {sections.map(sec => {
        const Icon = sec.icon;
        return (
          <div key={sec.title} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <Icon className="w-4 h-4 text-blue-600" />
              {sec.title}
            </h3>
            <ul className="space-y-1.5">
              {sec.items.map((item, i) => (
                <li key={i} className="text-sm text-slate-600 dark:text-slate-400 flex items-start gap-2">
                  <span className="text-blue-400 mt-1.5 shrink-0">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
