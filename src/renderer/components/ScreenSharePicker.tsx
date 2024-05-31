/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./screenSharePicker.css";

import { closeModal, Logger, Modals, ModalSize, openModal, useAwaiter } from "@vencord/types/utils";
import { findStoreLazy, onceReady } from "@vencord/types/webpack";
import {
    Button,
    Card,
    FluxDispatcher,
    Forms,
    Select,
    Switch,
    Text,
    UserStore,
    useState
} from "@vencord/types/webpack/common";
import { Node } from "@vencord/venmic";
import type { Dispatch, SetStateAction } from "react";
import { addPatch } from "renderer/patches/shared";
import { useSettings } from "renderer/settings";
import { isLinux, isWindows } from "renderer/utils";

const StreamResolutions = ["480", "720", "1080", "1440"] as const;
const StreamFps = ["15", "30", "60"] as const;

const MediaEngineStore = findStoreLazy("MediaEngineStore");

export type StreamResolution = (typeof StreamResolutions)[number];
export type StreamFps = (typeof StreamFps)[number];

type SpecialSource = "None" | "Entire System";

type AudioSource = SpecialSource | Node;
type AudioSources = SpecialSource | Node[];

interface AudioItem {
    name: string;
    value: AudioSource;
}

interface StreamSettings {
    resolution: StreamResolution;
    fps: StreamFps;
    audio: boolean;
    audioSources?: AudioSources;
    contentHint?: string;
}

export interface StreamPick extends StreamSettings {
    id: string;
}

interface Source {
    id: string;
    name: string;
    url: string;
}

export let currentSettings: StreamSettings | null = null;

const logger = new Logger("VesktopScreenShare");

addPatch({
    patches: [
        {
            find: "this.localWant=",
            replacement: {
                match: /this.localWant=/,
                replace: "$self.patchStreamQuality(this);$&"
            }
        }
    ],
    patchStreamQuality(opts: any) {
        if (!currentSettings) return;

        const framerate = Number(currentSettings.fps);
        const height = Number(currentSettings.resolution);
        const width = Math.round(height * (16 / 9));

        Object.assign(opts, {
            bitrateMin: 500000,
            bitrateMax: 8000000,
            bitrateTarget: 600000
        });
        if (opts?.encode) {
            Object.assign(opts.encode, {
                framerate,
                width,
                height,
                pixelCount: height * width
            });
        }
        Object.assign(opts.capture, {
            framerate,
            width,
            height,
            pixelCount: height * width
        });
    }
});

if (isLinux) {
    onceReady.then(() => {
        FluxDispatcher.subscribe("STREAM_CLOSE", ({ streamKey }: { streamKey: string }) => {
            const owner = streamKey.split(":").at(-1);

            if (owner !== UserStore.getCurrentUser().id) {
                return;
            }

            VesktopNative.virtmic.stop();
        });
    });
}

export function openScreenSharePicker(screens: Source[], skipPicker: boolean) {
    let didSubmit = false;
    return new Promise<StreamPick>((resolve, reject) => {
        const key = openModal(
            props => (
                <ModalComponent
                    screens={screens}
                    modalProps={props}
                    submit={async v => {
                        didSubmit = true;
                        if (v.audioSources && v.audioSources !== "None") {
                            if (v.audioSources === "Entire System") {
                                await VesktopNative.virtmic.startSystem();
                            } else {
                                await VesktopNative.virtmic.start(v.audioSources);
                            }
                        }
                        resolve(v);
                    }}
                    close={() => {
                        props.onClose();
                        if (!didSubmit) reject("Aborted");
                    }}
                    skipPicker={skipPicker}
                />
            ),
            {
                onCloseRequest() {
                    closeModal(key);
                    reject("Aborted");
                }
            }
        );
    });
}

function ScreenPicker({ screens, chooseScreen }: { screens: Source[]; chooseScreen: (id: string) => void }) {
    return (
        <div className="vcd-screen-picker-grid">
            {screens.map(({ id, name, url }) => (
                <label key={id}>
                    <input type="radio" name="screen" value={id} onChange={() => chooseScreen(id)} />

                    <img src={url} alt="" />
                    <Text variant="text-sm/normal">{name}</Text>
                </label>
            ))}
        </div>
    );
}

function AudioSettingsModal({
    modalProps,
    close,
    setAudioSources
}: {
    modalProps: any;
    close: () => void;
    setAudioSources: (s: AudioSources) => void;
}) {
    const Settings = useSettings();

    return (
        <Modals.ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <Modals.ModalHeader className="vcd-screen-picker-header">
                <Forms.FormTitle tag="h2">Venmic Settings</Forms.FormTitle>
                <Modals.ModalCloseButton onClick={close} />
            </Modals.ModalHeader>
            <Modals.ModalContent className="vcd-screen-picker-modal">
                <Switch
                    onChange={v => (Settings.audioWorkaround = v)}
                    value={Settings.audioWorkaround ?? false}
                    note={
                        <>
                            Work around an issue that causes the microphone to be shared instead of the correct audio.
                            Only enable if you're experiencing this issue.
                        </>
                    }
                >
                    Microphone Workaround
                </Switch>
                <Switch
                    hideBorder
                    onChange={v => (Settings.audioOnlyDefaultSpeakers = v)}
                    value={Settings.audioOnlyDefaultSpeakers ?? true}
                    note={<>When sharing entire desktop audio, only share apps that play to the default speakers.</>}
                >
                    Only Default Speakers
                </Switch>
                <Switch
                    hideBorder
                    onChange={v => (Settings.audioIgnoreInputMedia = v)}
                    value={Settings.audioIgnoreInputMedia ?? true}
                    note={<>Exclude nodes that are intended to capture audio.</>}
                >
                    Ignore Inputs
                </Switch>
                <Switch
                    hideBorder
                    onChange={v => (Settings.audioIgnoreVirtual = v)}
                    value={Settings.audioIgnoreVirtual ?? true}
                    note={
                        <>
                            Exclude virtual nodes, such as nodes belonging to sinks, this might be useful when using
                            "mix bussing"
                        </>
                    }
                >
                    Ignore Virtual
                </Switch>
                <Switch
                    hideBorder
                    onChange={value => {
                        Settings.audioGranularSelect = value;
                        setAudioSources("None");
                    }}
                    value={Settings.audioGranularSelect ?? false}
                    note={<>Allow to select applications more granularly.</>}
                >
                    Granular Selection
                </Switch>
            </Modals.ModalContent>
            <Modals.ModalFooter className="vcd-screen-picker-footer">
                <Button color={Button.Colors.TRANSPARENT} onClick={close}>
                    Back
                </Button>
            </Modals.ModalFooter>
        </Modals.ModalRoot>
    );
}

function StreamSettings({
    source,
    settings,
    setSettings,
    skipPicker
}: {
    source: Source;
    settings: StreamSettings;
    setSettings: Dispatch<SetStateAction<StreamSettings>>;
    skipPicker: boolean;
}) {
    const Settings = useSettings();

    const [thumb] = useAwaiter(
        () => (skipPicker ? Promise.resolve(source.url) : VesktopNative.capturer.getLargeThumbnail(source.id)),
        {
            fallbackValue: source.url,
            deps: [source.id]
        }
    );

    const openSettings = () => {
        const key = openModal(props => (
            <AudioSettingsModal
                modalProps={props}
                close={() => props.onClose()}
                setAudioSources={sources => setSettings(s => ({ ...s, audioSources: sources }))}
            />
        ));
    };

    return (
        <div>
            <Forms.FormTitle>What you're streaming</Forms.FormTitle>
            <Card className="vcd-screen-picker-card vcd-screen-picker-preview">
                <img
                    src={thumb}
                    alt=""
                    className={isLinux ? "vcd-screen-picker-preview-img-linux" : "vcd-screen-picker-preview-img"}
                />
                <Text variant="text-sm/normal">{source.name}</Text>
            </Card>

            <Forms.FormTitle>Stream Settings</Forms.FormTitle>

            <Card className="vcd-screen-picker-card">
                <div className="vcd-screen-picker-quality">
                    <section>
                        <Forms.FormTitle>Resolution</Forms.FormTitle>
                        <div className="vcd-screen-picker-radios">
                            {StreamResolutions.map(res => (
                                <label className="vcd-screen-picker-radio" data-checked={settings.resolution === res}>
                                    <Text variant="text-sm/bold">{res}</Text>
                                    <input
                                        type="radio"
                                        name="resolution"
                                        value={res}
                                        checked={settings.resolution === res}
                                        onChange={() => setSettings(s => ({ ...s, resolution: res }))}
                                    />
                                </label>
                            ))}
                        </div>
                    </section>

                    <section>
                        <Forms.FormTitle>Frame Rate</Forms.FormTitle>
                        <div className="vcd-screen-picker-radios">
                            {StreamFps.map(fps => (
                                <label className="vcd-screen-picker-radio" data-checked={settings.fps === fps}>
                                    <Text variant="text-sm/bold">{fps}</Text>
                                    <input
                                        type="radio"
                                        name="fps"
                                        value={fps}
                                        checked={settings.fps === fps}
                                        onChange={() => setSettings(s => ({ ...s, fps }))}
                                    />
                                </label>
                            ))}
                        </div>
                    </section>
                </div>
                <div className="vcd-screen-picker-quality">
                    <section>
                        <Forms.FormTitle>Content Type</Forms.FormTitle>
                        <div>
                            <div className="vcd-screen-picker-radios">
                                <label
                                    className="vcd-screen-picker-radio"
                                    data-checked={settings.contentHint === "motion"}
                                >
                                    <Text variant="text-sm/bold">Prefer Smoothness</Text>
                                    <input
                                        type="radio"
                                        name="contenthint"
                                        value="motion"
                                        checked={settings.contentHint === "motion"}
                                        onChange={() => setSettings(s => ({ ...s, contentHint: "motion" }))}
                                    />
                                </label>
                                <label
                                    className="vcd-screen-picker-radio"
                                    data-checked={settings.contentHint === "detail"}
                                >
                                    <Text variant="text-sm/bold">Prefer Clarity</Text>
                                    <input
                                        type="radio"
                                        name="contenthint"
                                        value="detail"
                                        checked={settings.contentHint === "detail"}
                                        onChange={() => setSettings(s => ({ ...s, contentHint: "detail" }))}
                                    />
                                </label>
                            </div>
                            <div className="vcd-screen-picker-hint-description">
                                <p>
                                    Choosing "Prefer Clarity" will result in a significantly lower framerate in exchange
                                    for a much sharper and clearer image.
                                </p>
                            </div>
                        </div>
                        {isWindows && (
                            <Switch
                                value={settings.audio}
                                onChange={checked => setSettings(s => ({ ...s, audio: checked }))}
                                hideBorder
                                className="vcd-screen-picker-audio"
                            >
                                Stream With Audio
                            </Switch>
                        )}
                    </section>
                </div>

                {isLinux && (
                    <AudioSourcePickerLinux
                        openSettings={openSettings}
                        audioSources={settings.audioSources}
                        granularSelect={Settings.audioGranularSelect}
                        setAudioSources={sources => setSettings(s => ({ ...s, audioSources: sources }))}
                    />
                )}
            </Card>
        </div>
    );
}

function isSpecialSource(value?: AudioSource | AudioSources): value is SpecialSource {
    return typeof value === "string";
}

function hasMatchingProps(value: Node, other: Node) {
    return Object.keys(value).every(key => value[key] === other[key]);
}

function mapToAudioItem(node: AudioSource, granularSelect?: boolean): AudioItem[] {
    if (isSpecialSource(node)) {
        return [{ name: node, value: node }];
    }

    const rtn: AudioItem[] = [];

    const name = node["application.name"];

    if (name) {
        rtn.push({ name: name, value: { "application.name": name } });
    }

    if (!granularSelect) {
        return rtn;
    }

    const binary = node["application.process.binary"];

    if (!name) {
        rtn.push({ name: binary, value: { "application.process.binary": binary } });
    }

    const pid = node["application.process.id"];

    const first = rtn[0];
    const firstValues = first.value as Node;

    rtn.push({
        name: `${first.name} (${pid})`,
        value: { ...firstValues, "application.process.id": pid }
    });

    const mediaName = node["media.name"];

    if (mediaName) {
        rtn.push({
            name: `${first.name} [${mediaName}]`,
            value: { ...firstValues, "media.name": mediaName }
        });
    }

    const mediaClass = node["media.class"];

    if (!mediaClass) {
        return rtn;
    }

    rtn.push({
        name: `${first.name} [${mediaClass}]`,
        value: { ...firstValues, "media.class": mediaClass }
    });

    return rtn;
}

function AudioSourcePickerLinux({
    audioSources,
    granularSelect,
    setAudioSources,
    openSettings
}: {
    audioSources?: AudioSources;
    granularSelect?: boolean;
    openSettings: () => void;
    setAudioSources: (s: AudioSources) => void;
}) {
    const [sources, _, loading] = useAwaiter(() => VesktopNative.virtmic.list(), {
        fallbackValue: { ok: true, targets: [], hasPipewirePulse: true }
    });

    const specialSources: SpecialSource[] = ["None", "Entire System"];
    const allSources = sources.ok ? [...specialSources, ...sources.targets] : null;

    const hasPipewirePulse = sources.ok ? sources.hasPipewirePulse : true;
    const [ignorePulseWarning, setIgnorePulseWarning] = useState(false);

    const isSelected = (value: AudioSource) => {
        if (!audioSources) {
            return false;
        }

        if (isSpecialSource(audioSources) || isSpecialSource(value)) {
            return audioSources === value;
        }

        return audioSources.some(source => hasMatchingProps(source, value));
    };

    const update = (value: SpecialSource | Node) => {
        if (isSpecialSource(value)) {
            setAudioSources(value);
            return;
        }

        if (isSpecialSource(audioSources)) {
            setAudioSources([value]);
            return;
        }

        if (isSelected(value)) {
            setAudioSources(audioSources?.filter(x => !hasMatchingProps(x, value)) ?? "None");
            return;
        }

        setAudioSources([...(audioSources || []), value]);
    };

    const uniqueName = (value: AudioItem, index: number, list: AudioItem[]) =>
        list.findIndex(x => x.name === value.name) === index;

    return (
        <div>
            {loading ? (
                <Forms.FormTitle>Loading Audio Sources...</Forms.FormTitle>
            ) : (
                <Forms.FormTitle>Audio Source</Forms.FormTitle>
            )}

            {!sources.ok && sources.isGlibCxxOutdated && (
                <Forms.FormText>
                    Failed to retrieve Audio Sources because your C++ library is too old to run
                    <a href="https://github.com/Vencord/venmic" target="_blank">
                        venmic
                    </a>
                    . See{" "}
                    <a href="https://gist.github.com/Vendicated/b655044ffbb16b2716095a448c6d827a" target="_blank">
                        this guide
                    </a>{" "}
                    for possible solutions.
                </Forms.FormText>
            )}

            {hasPipewirePulse || ignorePulseWarning ? (
                allSources && (
                    <Select
                        options={allSources
                            .map(target => mapToAudioItem(target, granularSelect))
                            .flat()
                            .filter(uniqueName)
                            .map(({ name, value }) => ({
                                label: name,
                                value: value,
                                default: name === "None"
                            }))}
                        isSelected={isSelected}
                        select={update}
                        serialize={String}
                        popoutPosition="top"
                    />
                )
            ) : (
                <Text variant="text-sm/normal">
                    Could not find pipewire-pulse. See{" "}
                    <a
                        href="https://gist.github.com/the-spyke/2de98b22ff4f978ebf0650c90e82027e#install"
                        target="_blank"
                    >
                        this guide
                    </a>{" "}
                    on how to switch to pipewire. <br />
                    You can still continue, however, please{" "}
                    <b>beware that you can only share audio of apps that are running under pipewire</b>.
                    <br />
                    <br />
                    <a onClick={() => setIgnorePulseWarning(true)}>I know what I'm doing</a>
                </Text>
            )}

            <Button
                color={Button.Colors.TRANSPARENT}
                onClick={openSettings}
                className="vcd-screen-picker-settings-button"
            >
                Open Audio Settings
            </Button>
        </div>
    );
}

function ModalComponent({
    screens,
    modalProps,
    submit,
    close,
    skipPicker
}: {
    screens: Source[];
    modalProps: any;
    submit: (data: StreamPick) => void;
    close: () => void;
    skipPicker: boolean;
}) {
    const [selected, setSelected] = useState<string | undefined>(skipPicker ? screens[0].id : void 0);
    const [settings, setSettings] = useState<StreamSettings>({
        resolution: "1080",
        fps: "60",
        contentHint: "motion",
        audio: true
    });

    return (
        <Modals.ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <Modals.ModalHeader className="vcd-screen-picker-header">
                <Forms.FormTitle tag="h2">ScreenShare</Forms.FormTitle>
                <Modals.ModalCloseButton onClick={close} />
            </Modals.ModalHeader>
            <Modals.ModalContent className="vcd-screen-picker-modal">
                {!selected ? (
                    <ScreenPicker screens={screens} chooseScreen={setSelected} />
                ) : (
                    <StreamSettings
                        source={screens.find(s => s.id === selected)!}
                        settings={settings}
                        setSettings={setSettings}
                        skipPicker={skipPicker}
                    />
                )}
            </Modals.ModalContent>
            <Modals.ModalFooter className="vcd-screen-picker-footer">
                <Button
                    disabled={!selected}
                    onClick={() => {
                        currentSettings = settings;
                        try {
                            const frameRate = Number(settings.fps);
                            const height = Number(settings.resolution);
                            const width = Math.round(height * (16 / 9));

                            const conn = [...MediaEngineStore.getMediaEngine().connections].find(
                                connection => connection.streamUserId === UserStore.getCurrentUser().id
                            );

                            if (conn) {
                                conn.videoStreamParameters[0].maxFrameRate = frameRate;
                                conn.videoStreamParameters[0].maxResolution.height = height;
                                conn.videoStreamParameters[0].maxResolution.width = width;
                            }

                            submit({
                                id: selected!,
                                ...settings
                            });

                            setTimeout(async () => {
                                const conn = [...MediaEngineStore.getMediaEngine().connections].find(
                                    connection => connection.streamUserId === UserStore.getCurrentUser().id
                                );
                                if (!conn) return;

                                const track = conn.input.stream.getVideoTracks()[0];

                                const constraints = {
                                    ...track.getConstraints(),
                                    frameRate,
                                    width: { min: 640, ideal: width, max: width },
                                    height: { min: 480, ideal: height, max: height },
                                    advanced: [{ width: width, height: height }],
                                    resizeMode: "none"
                                };

                                try {
                                    await track.applyConstraints(constraints);

                                    logger.info(
                                        "Applied constraints successfully. New constraints:",
                                        track.getConstraints()
                                    );
                                } catch (e) {
                                    logger.error("Failed to apply constraints.", e);
                                }
                            }, 100);
                        } catch (error) {
                            logger.error("Error while submitting stream.", error);
                        }

                        close();
                    }}
                >
                    Go Live
                </Button>

                {selected && !skipPicker ? (
                    <Button color={Button.Colors.TRANSPARENT} onClick={() => setSelected(void 0)}>
                        Back
                    </Button>
                ) : (
                    <Button color={Button.Colors.TRANSPARENT} onClick={close}>
                        Cancel
                    </Button>
                )}
            </Modals.ModalFooter>
        </Modals.ModalRoot>
    );
}
