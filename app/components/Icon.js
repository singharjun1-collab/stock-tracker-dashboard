/**
 * Icon.js — single source of truth for all icons in Stock Chatter.
 *
 * Why this file exists:
 *   We replaced the colorful emojis (🔥 🎯 🧠 💼 etc) with Lucide thin-outline
 *   icons to match the Robinhood design language: quiet, monochromatic, premium.
 *   This wrapper applies consistent stroke width, size, and color so every
 *   icon in the app feels like part of the same family.
 *
 * Usage:
 *   import { Ico } from '@/app/components/Icon';
 *   <Ico name="target" />                     // default inline size (14px)
 *   <Ico name="flame" size={16} />            // override size
 *   <Ico name="sparkles" className="ico-ai" />// add CSS hook for color/spacing
 *
 * Defaults:
 *   - strokeWidth: 1.75  (Robinhood-thin, not the default 2)
 *   - size:        14    (sits nicely inline with body text in card chips)
 *   - color:       inherits from parent text color via currentColor
 */
'use client';

import {
  // Card chips
  Target,
  Flame,
  Sparkles,
  Briefcase,
  Building2,
  Megaphone,
  DollarSign,
  Trash2,
  RotateCcw,
  Check,
  X as XIcon,
  // Banners / status
  AlertTriangle,
  Bot,
  Activity,
  Gift,
  Star,
  BellDot,
  // Landing-page features
  Smartphone,
  Mail,
  ShieldOff,
  SlidersHorizontal,
  // Sources
  FileText,
  Pill,
  Sunrise,
  Scissors,
  Flag,
  TrendingUp,
  Dna,
  Cog,
  MessageSquare,
  BarChart3,
  Globe,
  Shield,
  // Misc UI
  Trophy,
  ChevronUp,
  ChevronDown,
  Search,
  Bell,
  ArrowRight,
  ArrowLeft,
  Plus,
  Eye,
  Calendar,
  Clock,
  ArrowUpDown,
} from 'lucide-react';

const REGISTRY = {
  target: Target,
  flame: Flame,
  sparkles: Sparkles,
  briefcase: Briefcase,
  building: Building2,
  megaphone: Megaphone,
  dollar: DollarSign,
  trash: Trash2,
  undo: RotateCcw,
  check: Check,
  x: XIcon,
  warning: AlertTriangle,
  bot: Bot,
  activity: Activity,
  gift: Gift,
  star: Star,
  belldot: BellDot,    // "new picks today" — used in bottom nav + status chips
  phone: Smartphone,
  mail: Mail,
  shieldoff: ShieldOff,
  sliders: SlidersHorizontal,
  file: FileText,
  pill: Pill,
  sunrise: Sunrise,
  scissors: Scissors,
  flag: Flag,
  trend: TrendingUp,
  dna: Dna,
  cog: Cog,
  chat: MessageSquare,
  bar: BarChart3,
  globe: Globe,
  shield: Shield,
  trophy: Trophy,
  chevronup: ChevronUp,
  chevrondown: ChevronDown,
  search: Search,
  bell: Bell,
  arrowright: ArrowRight,
  arrowleft: ArrowLeft,
  plus: Plus,
  eye: Eye,
  calendar: Calendar,   // "first picked" date badge on cards
  clock: Clock,         // "last updated" date badge on cards
  sort: ArrowUpDown,    // Sort-by dropdown control
};

/**
 * <Ico name="target" /> — the only icon component you should call.
 * Falls back to a 14px square if the name is misspelled (so we never crash).
 */
export function Ico({ name, size = 14, strokeWidth = 1.75, className = '', ...rest }) {
  const Cmp = REGISTRY[name];
  if (!Cmp) {
    if (typeof window !== 'undefined') {
      // help future devs catch typos without breaking the page
      console.warn(`<Ico name="${name}" /> not in registry — add it to Icon.js`);
    }
    return <span style={{ display: 'inline-block', width: size, height: size }} aria-hidden="true" />;
  }
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      className={`ico ${className}`.trim()}
      aria-hidden="true"
      {...rest}
    />
  );
}

/**
 * <RankChip n={1} /> — replaces the 🥇🥈🥉 emoji medals with a clean
 * numbered green pill in the Robinhood/Linear leaderboard style.
 */
export function RankChip({ n }) {
  return <span className="rank-chip">#{n}</span>;
}

export default Ico;
