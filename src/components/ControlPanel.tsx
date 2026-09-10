import React, { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Button } from "./ui/button";
import {
  Download,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Zap,
  PanelLeftOpen,
  PanelLeftClose,
} from "lucide-react";
import PostMigrationOnboarding from "./PostMigrationOnboarding";
import { RequiredModelsBanner } from "./RequiredModelsBanner";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useDialogs } from "../hooks/useDialogs";
import { useHotkey } from "../hooks/useHotkey";
import { useToast } from "./ui/useToast";
import { useUpdater } from "../hooks/useUpdater";
import { useSettings } from "../hooks/useSettings";
import { useAuth } from "../hooks/useAuth";
import { useCollapsibleSidebar } from "../hooks/useCollapsibleSidebar";
import {
  useTranscriptions,
  useShowDiscarded,
  initializeTranscriptions,
  removeTranscription as removeFromStore,
  updateTranscription as updateInStore,
  clearTranscriptions as clearStore,
} from "../stores/transcriptionStore";
import {
  getSettings,
  selectPolicyEffectiveSettings,
  useSettingsStore,
} from "../stores/settingsStore";
import { usePolicyStore } from "../stores/policyStore";
import { usePolicySnapshot } from "../hooks/usePolicy";
import {
  isAgentAllowed,
  isTranscriptionContextAllowed,
  isUpdateRequiredByOrg,
} from "../stores/policyRules";
import { getManagedTranscriptionResolution } from "../services/managedTranscription";
import ControlPanelSidebar, { type ControlPanelView } from "./ControlPanelSidebar";
import WindowControls from "./WindowControls";

import { getCachedPlatform } from "../utils/platform";
import { isAccessibilitySkipped } from "../utils/permissions";
import { useGpuBannerAvailability } from "../hooks/useGpuBannerAvailability";

import {
  executeTranslationChain,
  hasTextContent,
  shouldRunTranslateStep,
} from "../helpers/translationChain";
import { applyChineseScript, resolveChineseScriptTarget } from "../utils/chineseScript";
import HistoryView from "./HistoryView";
import { PRODUCT_FEATURES } from "../config/productFeatures.js";
import logger from "../utils/logger";

const platform = getCachedPlatform();

const SIDEBAR_WIDTH_PX = 192;

const toggleIconClass =
  "text-foreground/60 group-hover:text-foreground/75 dark:text-foreground/50 dark:group-hover:text-foreground/65 transition-colors duration-150";

const SettingsModal = React.lazy(() => import("./SettingsModal"));
const DictionaryView = React.lazy(() => import("./DictionaryView"));

interface ControlPanelProps {
  /** Open the settings modal at this section on mount (e.g. after onboarding). */
  initialSettingsSection?: string;
}

export default function ControlPanel({ initialSettingsSection }: ControlPanelProps = {}) {
  const { t } = useTranslation();
  const history = useTranscriptions();
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(!!initialSettingsSection);
  const [showPostMigration, setShowPostMigration] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(
    initialSettingsSection
  );
  const [aiCTADismissed, setAiCTADismissed] = useState(
    () => localStorage.getItem("aiCTADismissed") === "true"
  );
  const showDiscarded = useShowDiscarded();
  const [activeView, setActiveView] = useState<ControlPanelView>("home");
  const {
    collapsed: sidebarCollapsed,
    peek: sidebarPeek,
    toggle: toggleSidebar,
    showPeek: showSidebarPeek,
    hidePeek: hideSidebarPeek,
    leaveToggle: leaveSidebarToggle,
  } = useCollapsibleSidebar();
  const isSidePanelLayout = false;
  const [gpuBannerDismissed, setGpuBannerDismissed] = useState(
    () => localStorage.getItem("gpuBannerDismissedUnified") === "true"
  );
  const updateReadyToastShown = useRef(false);
  const updateErrorToastShown = useRef<Error | null>(null);
  const { hotkey } = useHotkey();
  const { toast } = useToast();
  const { useCleanupModel } = useSettings();
  const { isSignedIn } = useAuth();

  const {
    status: updateStatus,
    downloadProgress,
    isDownloading,
    isInstalling,
    downloadUpdate,
    installUpdate,
    error: updateError,
  } = useUpdater();

  const agentAllowedByPolicy = usePolicyStore(isAgentAllowed);
  const updateRequiredByOrg = usePolicyStore(isUpdateRequiredByOrg);
  const policyMinAppVersion = usePolicyStore((s) => s.policy?.minAppVersion ?? null);

  // Policy-effective, because the settings pane the GPU banner links to renders
  // the clamped mode — see eligibleGpuOffers.
  const policySnapshot = usePolicySnapshot();
  const gpuBannerSettings = useSettingsStore(
    useShallow((settings) => {
      const effective = selectPolicyEffectiveSettings(settings, policySnapshot);
      return {
        useLocalWhisper: effective.useLocalWhisper,
        localTranscriptionProvider: effective.localTranscriptionProvider,
        useCleanupModel: effective.useCleanupModel,
        cleanupMode: effective.cleanupMode,
        useDictationAgent: effective.useDictationAgent,
        dictationAgentMode: effective.dictationAgentMode,
      };
    })
  );
  const gpuAccelAvailable = useGpuBannerAvailability({
    settings: gpuBannerSettings,
    agentAllowedByPolicy,
    dismissed: gpuBannerDismissed,
    settingsOpen: showSettings,
    platform,
  });

  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  const loadTranscriptions = useCallback(
    async (includeDiscarded?: boolean) => {
      try {
        setIsLoading(true);
        await initializeTranscriptions(undefined, includeDiscarded);
      } catch {
        showAlertDialog({
          title: t("controlPanel.history.couldNotLoadTitle"),
          description: t("controlPanel.history.couldNotLoadDescription"),
        });
      } finally {
        setIsLoading(false);
      }
    },
    [showAlertDialog, t]
  );

  useEffect(() => {
    loadTranscriptions();
  }, [loadTranscriptions]);

  useEffect(() => {
    if (platform !== "darwin") return;
    window.electronAPI?.getPostMigrationState?.().then((state) => {
      if (state?.justMigrated) setShowPostMigration(true);
    });
  }, []);

  const dismissPostMigrationPermanently = useCallback(async () => {
    await window.electronAPI?.markBundleMigrated?.();
    setShowPostMigration(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = platform === "darwin" ? e.metaKey : e.ctrlKey;
      if (mod && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (updateStatus.updateDownloaded && !isDownloading) {
      if (!updateReadyToastShown.current) {
        updateReadyToastShown.current = true;
        toast({
          title: t("controlPanel.update.readyTitle"),
          description: t("controlPanel.update.readyDescription"),
          variant: "success",
        });
      }
    } else {
      updateReadyToastShown.current = false;
    }
  }, [updateStatus.updateDownloaded, isDownloading, toast, t]);

  useEffect(() => {
    if (updateError && updateError !== updateErrorToastShown.current) {
      updateErrorToastShown.current = updateError;
      toast({
        title: t("controlPanel.update.problemTitle"),
        description: t("controlPanel.update.problemDescription"),
        variant: "destructive",
      });
    }
    if (!updateError) {
      updateErrorToastShown.current = null;
    }
  }, [updateError, toast, t]);

  useEffect(() => {
    const cleanup = window.electronAPI?.onShowSettings?.(() => {
      setShowSettings(true);
    });
    return () => cleanup?.();
  }, []);

  // When accessibility is missing on macOS, open the permissions settings page
  useEffect(() => {
    const cleanup = window.electronAPI?.onAccessibilityMissing?.(async () => {
      if (isAccessibilitySkipped()) return;
      const migration = await window.electronAPI?.getPostMigrationState?.();
      if (migration?.justMigrated) return;
      setSettingsSection("privacyData");
      setShowSettings(true);
      toast({
        title: t("controlPanel.accessibilityMissing.title"),
        description: t("controlPanel.accessibilityMissing.description"),
        duration: 10000,
      });
    });
    return () => cleanup?.();
  }, [toast, t]);

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast({
          title: t("controlPanel.history.copiedTitle"),
          description: t("controlPanel.history.copiedDescription"),
          variant: "success",
          duration: 2000,
        });
      } catch (err) {
        toast({
          title: t("controlPanel.history.couldNotCopyTitle"),
          description: t("controlPanel.history.couldNotCopyDescription"),
          variant: "destructive",
        });
      }
    },
    [toast, t]
  );

  const deleteTranscription = useCallback(
    async (id: number) => {
      showConfirmDialog({
        title: t("controlPanel.history.deleteTitle"),
        description: t("controlPanel.history.deleteDescription"),
        onConfirm: async () => {
          try {
            const result = await window.electronAPI.deleteTranscription(id);
            if (result.success) {
              removeFromStore(id);
            } else {
              showAlertDialog({
                title: t("controlPanel.history.couldNotDeleteTitle"),
                description: t("controlPanel.history.couldNotDeleteDescription"),
              });
            }
          } catch {
            showAlertDialog({
              title: t("controlPanel.history.couldNotDeleteTitle"),
              description: t("controlPanel.history.couldNotDeleteDescriptionGeneric"),
            });
          }
        },
        variant: "destructive",
      });
    },
    [showConfirmDialog, showAlertDialog, t]
  );

  const clearAllTranscriptions = useCallback(() => {
    showConfirmDialog({
      title: t("controlPanel.history.clearAllTitle"),
      description: t(
        isSignedIn
          ? "controlPanel.history.clearAllDescription"
          : "controlPanel.history.clearAllDescriptionDevice"
      ),
      onConfirm: async () => {
        try {
          const result = await window.electronAPI.clearTranscriptions();
          if (result.success) {
            clearStore();
            toast({
              title: t("controlPanel.history.clearAllSuccess"),
              variant: "success",
              duration: 2000,
            });
          } else {
            showAlertDialog({
              title: t("controlPanel.history.clearAllErrorTitle"),
              description: t("controlPanel.history.clearAllErrorDescription"),
            });
          }
        } catch {
          showAlertDialog({
            title: t("controlPanel.history.clearAllErrorTitle"),
            description: t("controlPanel.history.clearAllErrorDescription"),
          });
        }
      },
      variant: "destructive",
    });
  }, [isSignedIn, showConfirmDialog, showAlertDialog, toast, t]);

  const showAudioInFolder = useCallback(
    async (id: number) => {
      try {
        const result = await window.electronAPI.showAudioInFolder(id);
        if (!result?.success) {
          toast({
            title: t("controlPanel.history.audioNotFound"),
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: t("controlPanel.history.audioNotFound"),
          variant: "destructive",
        });
      }
    },
    [toast, t]
  );

  const retryTranscription = useCallback(
    async (id: number, options?: { isRecover?: boolean }) => {
      try {
        const s = getSettings();
        const managed = getManagedTranscriptionResolution();
        if (managed?.kind === "error") {
          toast({
            title: managed.messageKey ? t(managed.messageKey) : managed.message,
            variant: "destructive",
          });
          return;
        }
        if (!managed && !isTranscriptionContextAllowed(usePolicyStore.getState(), s, "dictation")) {
          toast({ title: t("common.managedByOrg"), variant: "default" });
          return;
        }
        const result = await window.electronAPI.retryTranscription(id, {
          managed,
          useLocalWhisper: s.useLocalWhisper,
          localTranscriptionProvider: s.localTranscriptionProvider,
          cloudTranscriptionMode: s.cloudTranscriptionMode,
          cloudTranscriptionProvider: s.cloudTranscriptionProvider,
          cloudTranscriptionModel: s.cloudTranscriptionModel,
          cloudTranscriptionBaseUrl: s.cloudTranscriptionBaseUrl,
          cortiEnvironment: s.cortiEnvironment,
          cortiTenant: s.cortiTenant,
          parakeetModel: s.parakeetModel,
          cohereModel: s.cohereModel,
          whisperModel: s.whisperModel,
          preferredLanguage: s.preferredLanguage,
          transcriptionMode: s.transcriptionMode,
          remoteTranscriptionType: s.remoteTranscriptionType,
          remoteTranscriptionUrl: s.remoteTranscriptionUrl,
          remoteTranscriptionModel: s.remoteTranscriptionModel,
        });
        if (result.success && result.transcription) {
          const rawText = result.transcription.text;
          let finalTranscription = result.transcription;

          // A translation dictation must re-run cleanup-then-translate on retry, not plain cleanup.
          let handledTranslation = false;
          let translationApplied = false;
          if (result.transcription.route_kind === "translation") {
            handledTranslation = true;
            try {
              const [
                { default: ReasoningService },
                { resolveReasoningRoute },
                { getEffectiveCleanupModel, getSettings: getEffectiveSettings },
              ] = await Promise.all([
                import("../services/ReasoningService"),
                import("../helpers/audioManager"),
                import("../stores/settingsStore"),
              ]);
              const settings = getEffectiveSettings();
              const agentName = localStorage.getItem("agentName") || null;
              const route = resolveReasoningRoute(rawText, settings, agentName, false, true);
              if (route.kind === "translation") {
                const { text, translated } = await executeTranslationChain({
                  text: rawText,
                  cleanupReachable: route.cleanupReachable,
                  runCleanup: (currentText: string) =>
                    ReasoningService.processText(
                      currentText,
                      getEffectiveCleanupModel(),
                      agentName,
                      route.cleanupConfig
                    ),
                  runTranslate: (currentText: string) =>
                    ReasoningService.processText(currentText, route.model, agentName, route.config),
                  shouldTranslate: shouldRunTranslateStep(
                    settings.translationSourceLanguage,
                    settings.translationTargetLanguage
                  ),
                  onCleanupError: (cleanupError: Error) =>
                    logger.warn(
                      "Cleanup step failed in translation chain, translating raw transcript",
                      { error: cleanupError.message },
                      "transcription"
                    ),
                  onEmptyTranslate: () =>
                    logger.warn(
                      "Translation step returned empty text, keeping previous text",
                      {},
                      "transcription"
                    ),
                  onUnchangedTranslate: () =>
                    logger.warn(
                      "Translation step returned unchanged text, keeping source text",
                      {},
                      "transcription"
                    ),
                });
                translationApplied = translated;
                if (text !== rawText) {
                  const updated = await window.electronAPI.updateTranscriptionText(
                    id,
                    text,
                    rawText
                  );
                  if (updated.success && updated.transcription) {
                    finalTranscription = updated.transcription;
                  }
                }
              } else {
                // Translation disabled/unreachable since recording — fall through to cleanup.
                handledTranslation = false;
              }
            } catch {
              // Reasoning failed — keep the raw STT result
            }
          }

          // Apply AI reasoning if enabled
          if (!handledTranslation && useCleanupModel) {
            try {
              const [
                { default: ReasoningService },
                { getEffectiveCleanupModel, isCloudCleanupMode, getSettings },
              ] = await Promise.all([
                import("../services/ReasoningService"),
                import("../stores/settingsStore"),
              ]);
              const model = getEffectiveCleanupModel();
              const isCloud = isCloudCleanupMode();
              if (model || isCloud) {
                const agentName = localStorage.getItem("agentName") || null;
                const reasonedText = await ReasoningService.processText(rawText, model, agentName, {
                  disableThinking: getSettings().cleanupDisableThinking,
                });
                if (hasTextContent(reasonedText) && reasonedText !== rawText) {
                  const updated = await window.electronAPI.updateTranscriptionText(
                    id,
                    reasonedText,
                    rawText
                  );
                  if (updated.success && updated.transcription) {
                    finalTranscription = updated.transcription;
                  }
                }
              }
            } catch {
              // Reasoning failed — keep the raw STT result
            }
          }

          // Deterministic Chinese script pass, mirroring dictation (#975). Runs last so
          // it covers the cleaned/translated text, or the raw transcript when neither ran.
          // Same rule as audioManager.getEffectiveOutputLanguage: only a completed
          // translate step moves the text into the target language, so anything else
          // still has to be scripted as the language that was dictated.
          try {
            const outputLanguage =
              result.transcription.route_kind === "translation"
                ? (translationApplied
                    ? s.translationTargetLanguage
                    : s.translationSourceLanguage) || "auto"
                : s.preferredLanguage;
            const scripted = await applyChineseScript(
              finalTranscription.text,
              resolveChineseScriptTarget(
                outputLanguage,
                s.chineseScriptPreference,
                finalTranscription.text
              )
            );
            if (scripted !== finalTranscription.text) {
              const updated = await window.electronAPI.updateTranscriptionText(
                id,
                scripted,
                rawText
              );
              if (updated.success && updated.transcription) {
                finalTranscription = updated.transcription;
              }
            }
          } catch {
            // Conversion failed — keep the text as transcribed
          }

          updateInStore(finalTranscription);
          toast({
            title: t(
              options?.isRecover
                ? "controlPanel.history.discarded.recovered"
                : "controlPanel.history.retrySuccess"
            ),
          });
        } else {
          toast({
            title: t("controlPanel.history.retryError"),
            description: result.messageKey ? t(result.messageKey) : result.error,
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: t("controlPanel.history.retryError"),
          variant: "destructive",
        });
      }
    },
    [toast, t, useCleanupModel]
  );

  const toggleShowDiscarded = useCallback(() => {
    loadTranscriptions(!showDiscarded);
  }, [loadTranscriptions, showDiscarded]);

  const handleUpdateClick = async () => {
    if (updateStatus.updateDownloaded) {
      showConfirmDialog({
        title: t("controlPanel.update.installTitle"),
        description: t("controlPanel.update.installDescription"),
        onConfirm: async () => {
          try {
            await installUpdate();
          } catch (error) {
            toast({
              title: t("controlPanel.update.couldNotInstallTitle"),
              description: t("controlPanel.update.couldNotInstallDescription"),
              variant: "destructive",
            });
          }
        },
      });
    } else if (updateStatus.updateAvailable && !isDownloading) {
      try {
        await downloadUpdate();
      } catch (error) {
        toast({
          title: t("controlPanel.update.couldNotDownloadTitle"),
          description: t("controlPanel.update.couldNotDownloadDescription"),
          variant: "destructive",
        });
      }
    }
  };

  const getUpdateButtonContent = () => {
    if (isInstalling) {
      return (
        <>
          <Loader2 size={14} className="animate-spin" />
          <span>{t("controlPanel.update.installing")}</span>
        </>
      );
    }
    if (isDownloading) {
      return (
        <>
          <Loader2 size={14} className="animate-spin" />
          <span>{Math.round(downloadProgress)}%</span>
        </>
      );
    }
    if (updateStatus.updateDownloaded) {
      return (
        <>
          <RefreshCw size={14} />
          <span>{t("controlPanel.update.installButton")}</span>
        </>
      );
    }
    if (updateStatus.updateAvailable) {
      return (
        <>
          <Download size={14} />
          <span>{t("controlPanel.update.availableButton")}</span>
        </>
      );
    }
    return null;
  };

  return (
    <div className="h-screen bg-background flex flex-col">
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={hideConfirmDialog}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={hideAlertDialog}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      <PostMigrationOnboarding
        open={showPostMigration}
        onOpenChange={setShowPostMigration}
        onDone={dismissPostMigrationPermanently}
      />

      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            open={showSettings}
            onOpenChange={(open) => {
              setShowSettings(open);
              if (!open) setSettingsSection(undefined);
            }}
            initialSection={settingsSection}
          />
        </Suspense>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        <div
          className="shrink-0 transition-[width] duration-300 ease-out"
          style={{ width: sidebarCollapsed || isSidePanelLayout ? 0 : SIDEBAR_WIDTH_PX }}
        />
        <div
          className={`absolute inset-y-0 left-0 z-30 transition-transform duration-300 ease-out${
            sidebarCollapsed && sidebarPeek && !isSidePanelLayout
              ? " shadow-[10px_0_40px_-18px_rgba(0,0,0,0.2)]"
              : ""
          }`}
          style={{
            transform:
              !isSidePanelLayout && (!sidebarCollapsed || sidebarPeek)
                ? "translateX(0)"
                : "translateX(-100%)",
          }}
          onMouseEnter={sidebarCollapsed ? showSidebarPeek : undefined}
          onMouseLeave={sidebarCollapsed ? hideSidebarPeek : undefined}
        >
          <ControlPanelSidebar
            activeView={activeView}
            onViewChange={setActiveView}
            onOpenSettings={() => {
              setSettingsSection(undefined);
              setShowSettings(true);
            }}
            updateAction={
              PRODUCT_FEATURES.appUpdates &&
              !updateStatus.isDevelopment &&
              (updateStatus.updateAvailable ||
                updateStatus.updateDownloaded ||
                isDownloading ||
                isInstalling) ? (
                <Button
                  variant={updateStatus.updateDownloaded ? "default" : "outline"}
                  size="sm"
                  onClick={handleUpdateClick}
                  disabled={isInstalling || isDownloading}
                  className="gap-1.5 text-xs w-full h-7"
                >
                  {getUpdateButtonContent()}
                </Button>
              ) : undefined
            }
          />
        </div>
        <main className="flex-1 flex flex-col overflow-hidden">
          <div
            className="flex items-center justify-between w-full h-10 shrink-0"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          >
            <div className="flex-1" />
            {platform !== "darwin" && (
              <div
                className="pr-1"
                data-no-window-drag=""
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                <WindowControls />
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto pt-1">
            {updateRequiredByOrg && (
              <div className="max-w-3xl mx-auto w-full mb-3">
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 p-3">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-md bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                      <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-amber-900 dark:text-amber-200 mb-0.5">
                        {t("controlPanel.updateRequiredByOrg.title")}
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300/80">
                        {t("controlPanel.updateRequiredByOrg.description", {
                          version: policyMinAppVersion,
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <RequiredModelsBanner />
            {(gpuAccelAvailable.transcription || gpuAccelAvailable.intelligence) &&
              activeView === "home" &&
              !gpuBannerDismissed && (
                <div className="max-w-3xl mx-auto w-full mb-3">
                  <div className="rounded-lg border border-primary/20 dark:border-primary/15 bg-primary/5 p-3">
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 w-8 h-8 rounded-md bg-primary/10 dark:bg-primary/15 flex items-center justify-center">
                        <Zap size={16} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground mb-0.5">
                          {t("controlPanel.gpu.bannerTitle")}
                        </p>
                        <p className="text-xs text-muted-foreground mb-2">
                          {t("controlPanel.gpu.bannerDescription")}
                        </p>
                        <div className="flex items-center gap-3">
                          <Button
                            variant="default"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              setSettingsSection(
                                gpuAccelAvailable.transcription
                                  ? "transcription"
                                  : gpuAccelAvailable.intelligence === "dictationAgent"
                                    ? "dictationAgent"
                                    : "intelligence"
                              );
                              setShowSettings(true);
                            }}
                          >
                            {t("controlPanel.gpu.enableButton")}
                          </Button>
                          <button
                            onClick={() => {
                              setGpuBannerDismissed(true);
                              localStorage.setItem("gpuBannerDismissedUnified", "true");
                            }}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {t("controlPanel.gpu.dismissButton")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            {activeView === "home" && (
              <HistoryView
                history={history}
                isLoading={isLoading}
                hotkey={hotkey}
                aiCTADismissed={aiCTADismissed}
                setAiCTADismissed={setAiCTADismissed}
                useCleanupModel={useCleanupModel}
                copyToClipboard={copyToClipboard}
                deleteTranscription={deleteTranscription}
                clearAllTranscriptions={clearAllTranscriptions}
                onShowAudioInFolder={showAudioInFolder}
                onRetryTranscription={retryTranscription}
                showDiscarded={showDiscarded}
                onToggleDiscarded={toggleShowDiscarded}
                onOpenSettings={(section) => {
                  setSettingsSection(section);
                  setShowSettings(true);
                }}
              />
            )}
            {activeView === "dictionary" && (
              <Suspense fallback={null}>
                <DictionaryView />
              </Suspense>
            )}
          </div>
        </main>
        {!isSidePanelLayout && (
          <div
            className={`absolute z-40 flex h-10 items-center ${
              platform === "darwin" ? "left-21 top-2" : "left-2 top-0"
            }`}
            data-no-window-drag=""
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            onMouseEnter={sidebarCollapsed ? showSidebarPeek : undefined}
            onMouseLeave={sidebarCollapsed ? leaveSidebarToggle : undefined}
          >
            <button
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
              className="group flex items-center justify-center h-7 w-7 rounded-md outline-none hover:bg-foreground/5 dark:hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-primary/30 transition-colors duration-150"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={15} className={toggleIconClass} />
              ) : (
                <PanelLeftClose size={15} className={toggleIconClass} />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
