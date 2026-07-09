import { ShieldCheck, MessageSquare, Tag, LifeBuoy, Truck, BadgeCheck, Clock, Star, Heart, ThumbsUp } from 'lucide-react';
import type React from 'react';

export const TRUST_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  ShieldCheck, MessageSquare, Tag, LifeBuoy, Truck, BadgeCheck, Clock, Star, Heart, ThumbsUp,
};
