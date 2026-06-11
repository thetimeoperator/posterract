import { useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import clsx from "clsx";
import { Home, PlusCircle, Send } from "lucide-react";
import { CapsuleDock } from "./hud/CapsuleDock";
import { CapsuleShelf } from "./hud/CapsuleShelf";
import { HomeActions } from "./hud/HomeActions";
import { CoreScene } from "./core3d/CoreScene";
import { CreatorVaultMenu } from "./hud/CreatorVaultMenu";
import { ModePanel } from "./hud/ModePanel";
import { OutputBay } from "./hud/OutputBay";
import { PlatformPanel } from "./hud/PlatformPanel";
import { PostComposer } from "./hud/PostComposer";
import { PublishQueue } from "./hud/PublishQueue";
import { PromptBay } from "./hud/PromptBay";
import { RunTimeline } from "./hud/RunTimeline";
import { SystemTelemetry } from "./hud/SystemTelemetry";
import { useVidtryxStore } from "./state/useVidtryxStore";

function App() {
  const {
    modes,
    productSurface,
    selectedModeId,
    phase,
    prompt,
    files,
    runId,
    currentStageLabel,
    currentStageIndex,
    stageProgress,
    overallProgress,
    runLog,
    artifacts,
    outputUrl,
    capsules,
    selectedCapsuleId,
    platformAccounts,
    selectedPlatformIds,
    scheduleMode,
    scheduledFor,
    postCaption,
    publishJobs,
    setProductSurface,
    openCreate,
    openPost,
    selectCapsule,
    updatePostCaption,
    togglePlatform,
    setScheduleMode,
    setScheduledFor,
    schedulePublish,
    syncSocialBackend,
    selectMode,
    setPrompt,
    addFiles,
    removeFile,
    startRun,
    resetRun,
  } = useVidtryxStore();

  useEffect(() => {
    void syncSocialBackend();
  }, [syncSocialBackend]);

  const selectedMode = useMemo(
    () => modes.find((mode) => mode.id === selectedModeId) ?? modes[0],
    [modes, selectedModeId],
  );

  const selectedCapsule = useMemo(
    () => capsules.find((capsule) => capsule.id === selectedCapsuleId) ?? capsules[0],
    [capsules, selectedCapsuleId],
  );

  const selectedConnectedPlatformCount = useMemo(
    () =>
      platformAccounts.filter((account) => account.connected && selectedPlatformIds.includes(account.id)).length,
    [platformAccounts, selectedPlatformIds],
  );

  const postActive = productSurface === "post" || productSurface === "schedule" || productSurface === "capsule-detail";
  const coreAccent = postActive ? "#7cf7ff" : selectedMode.color;
  const readoutTitle =
    productSurface === "home" ? "VIDTRYX CORE" : postActive ? "POST MODE" : selectedMode.name.replace(" Mode", "");
  const readoutStatus =
    productSurface === "home"
      ? "Create / Post"
      : postActive
        ? selectedCapsule?.title ?? "Select capsule"
        : currentStageLabel;

  return (
    <main className="vidtryx-shell" data-phase={phase} data-product-surface={productSurface}>
      <div className="chamber-bg" />
      <div className="core-stage">
        <CoreScene
          modes={modes}
          selectedMode={selectedMode}
          productSurface={productSurface}
          phase={phase}
          overallProgress={overallProgress}
          stageProgress={stageProgress}
          currentStageIndex={currentStageIndex}
          artifactCount={artifacts.length}
          publishJobCount={publishJobs.length}
          runLog={runLog}
          platformAccounts={platformAccounts}
          selectedPlatformIds={selectedPlatformIds}
          onSelectMode={selectMode}
        />
        <div className="core-readout" style={{ "--mode-color": coreAccent } as CSSProperties}>
          <span>{readoutTitle}</span>
          <strong>{readoutStatus}</strong>
        </div>
      </div>

      <div className="hud-layer">
        <nav className="surface-switcher hud-panel" aria-label="Vidtryx surface">
          <button
            data-testid="surface-home"
            className={clsx(productSurface === "home" && "is-active")}
            type="button"
            onClick={() => setProductSurface("home")}
          >
            <Home size={14} />
            Home
          </button>
          <button
            data-testid="surface-create"
            className={clsx(productSurface === "create" && "is-active")}
            type="button"
            onClick={openCreate}
          >
            <PlusCircle size={14} />
            Create
          </button>
          <button data-testid="surface-post" className={clsx(postActive && "is-active")} type="button" onClick={() => openPost()}>
            <Send size={14} />
            Post
          </button>
        </nav>

        {productSurface === "home" && (
          <>
            <HomeActions
              capsules={capsules}
              platformAccounts={platformAccounts}
              publishJobs={publishJobs}
              onCreate={openCreate}
              onPost={() => openPost()}
            />
            <CapsuleDock
              capsules={capsules}
              selectedCapsuleId={selectedCapsuleId}
              onSelectCapsule={selectCapsule}
              onOpenPost={openPost}
            />
          </>
        )}

        {productSurface === "create" && (
          <>
            <ModePanel
              mode={selectedMode}
              phase={phase}
              progress={overallProgress}
              status={currentStageLabel}
              runId={runId}
              onReset={resetRun}
            />
            <OutputBay
              artifacts={artifacts}
              outputUrl={outputUrl}
              phase={phase}
              capsule={selectedCapsule}
              onSendToPost={openPost}
            />
            <RunTimeline entries={runLog} />
            <SystemTelemetry phase={phase} color={selectedMode.color} stageProgress={stageProgress} />
            <PromptBay
              prompt={prompt}
              files={files}
              phase={phase}
              onPromptChange={setPrompt}
              onAddFiles={addFiles}
              onRemoveFile={removeFile}
              onGenerate={startRun}
            />
          </>
        )}

        {postActive && (
          <>
            <CapsuleShelf capsules={capsules} selectedCapsuleId={selectedCapsuleId} onSelectCapsule={selectCapsule} />
            <PlatformPanel
              accounts={platformAccounts}
              selectedPlatformIds={selectedPlatformIds}
              onTogglePlatform={togglePlatform}
            />
            <PublishQueue jobs={publishJobs} capsules={capsules} platformAccounts={platformAccounts} />
            <PostComposer
              capsule={selectedCapsule}
              caption={postCaption}
              scheduleMode={scheduleMode}
              scheduledFor={scheduledFor}
              selectedPlatformCount={selectedConnectedPlatformCount}
              onCaptionChange={updatePostCaption}
              onScheduleModeChange={setScheduleMode}
              onScheduledForChange={setScheduledFor}
              onSchedulePublish={schedulePublish}
            />
          </>
        )}

        <CreatorVaultMenu
          capsules={capsules}
          selectedCapsuleId={selectedCapsuleId}
          platformAccounts={platformAccounts}
          publishJobs={publishJobs}
          onSelectCapsule={selectCapsule}
          onOpenPost={openPost}
        />
      </div>
    </main>
  );
}

export default App;
