import { useEffect, useMemo, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { PlatformBrandMark } from "@posterract/hyperkit";
import type { CardImagesDTO } from "@posterract/contract";
import { fetchCardImages, useLeaderboard, usePointsDashboard } from "@/engine/useEngine";
import { RankEmblem } from "@/components/points/RankEmblem";
import { rankCard } from "@/components/rankcard/cardModel";
import { useCardAssets } from "@/components/rankcard/cardAssets";
import { RankCardView } from "@/components/rankcard/RankCardView";
import { CardActions, usePlayer, usePlayingAccounts } from "@/components/rankcard/CardActions";
import "@/styles/points.css";
import "@/styles/rankcard.css";
import "@/styles/profile.css";

export const Route = createFileRoute("/_app/profile")({ component: Profile });

/**
 * The profile: who you are, and your rank card as it stands now, ready to
 * post. Cards for single videos are made from Points → Recent points.
 */
function Profile() {
  const dashboard = usePointsDashboard();
  const week = useLeaderboard("week");
  const allTime = useLeaderboard("all");
  const accounts = usePlayingAccounts();
  const player = usePlayer(week);

  const card = useMemo(() => (dashboard ? rankCard(dashboard, week, allTime, player) : undefined), [dashboard, week, allTime, player]);
  const [pictures, setPictures] = useState<CardImagesDTO>();
  useEffect(() => {
    let live = true;
    void fetchCardImages([], true)
      .then((loaded) => {
        if (live) setPictures(loaded);
      })
      .catch(() => {
        if (live) setPictures({ covers: {} });
      });
    return () => {
      live = false;
    };
  }, []);
  const assets = useCardAssets(card, pictures);

  // The card fills its column up to 420px wide, so it fits a phone too.
  const stageRef = useRef<HTMLDivElement>(null);
  const [cardWidth, setCardWidth] = useState(420);
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setCardWidth(Math.max(240, Math.min(420, Math.floor((entry?.contentRect.width ?? 420) - 8))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [Boolean(card)]);

  const level = dashboard?.level ?? 1;
  return (
    <div className="career profile" data-testid="profile-page">
      <header className="career-head profile-head">
        <div className="career-head__main">
          <p className="career-head__kicker">◆ Profile</p>
          <h1 className="career-head__title profile-head__name">{player.name}</h1>
          <div className="profile-head__accounts">
            {accounts.length === 0 ? (
              <Link to="/portals" className="profile-head__connect">Connect an account</Link>
            ) : (
              accounts.slice(0, 6).map((portal) => (
                <span key={portal.id} className="profile-account">
                  <PlatformBrandMark platform={portal.provider} height={14} decorative />
                  {portal.handle || portal.displayName}
                </span>
              ))
            )}
          </div>
        </div>
        {dashboard && (
          <Link to="/points" className="career-chip profile-head__rank" aria-label="Your points and rank">
            <RankEmblem level={level} size={46} />
            <div>
              <p className="career-chip__name">{dashboard.rank.label}</p>
              <p className="career-chip__level">Level {level}</p>
            </div>
          </Link>
        )}
      </header>

      {!card ? (
        <section className="cr-panel">
          <div className="cr-empty">
            <strong>Loading your card</strong>
            Adding up what your posts have earned.
          </div>
        </section>
      ) : (
        <section className="cr-panel profile-stage" aria-label="Your rank card">
          <header className="cr-panel__head">
            <h2 className="cr-panel__title">Rank card</h2>
            <p className="cr-panel__meta">Always your current numbers</p>
          </header>
          <div className="profile-stage__body">
            <div className="profile-stage__card" ref={stageRef}>
              <RankCardView model={card} assets={assets} width={cardWidth} />
            </div>
            <div className="profile-stage__side">
              <CardActions model={card} assets={assets} />
              <Link to="/points" className="profile-videos">
                <span>
                  <b>Cards for your videos</b>
                  Every video in Points → Recent points has a Card button.
                </span>
                <ArrowUpRight size={16} />
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
