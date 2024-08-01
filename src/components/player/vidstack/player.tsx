"use client"

// https://github.com/Miruro-no-kuon/Miruro/blob/main/src/components/Watch/Video/Player.tsx
import "@vidstack/react/player/styles/default/theme.css"
import "@vidstack/react/player/styles/default/layouts/video.css"
import { useEffect, useRef, useState, useMemo, useCallback } from "react"
import {
  isHLSProvider,
  MediaPlayer,
  MediaProvider,
  Poster,
  Track,
  Captions,
  TextTrack,
  useMediaRemote,
  type MediaProviderAdapter,
  type MediaProviderChangeEvent,
  type MediaPlayerInstance,
} from "@vidstack/react"
import type {
  IAnilistInfo,
  IEpisode,
  Source,
  SourcesResponse,
} from "types/types"
import {
  increment,
  createViewCounter,
  createWatchlist,
  updateWatchlist,
} from "@/server/anime"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useStore } from "zustand"
import { useAutoSkip, useAutoNext, useAutoPlay } from "@/store"
import { env } from "@/env.mjs"
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
} from "@vidstack/react/player/layouts/default"
import { Button } from "@/components/ui/button"
import {
  fetchAnimeInfoFallback,
  fetchAnimeStreamingLinks,
  fetchSkipTimes,
  fetchAnimeStreamingLinksFallback,
} from "@/lib/cache"
import { useWatchStore } from "@/store"
import { AniSkipResult, AniSkip } from "types/types"

type VidstackPlayerProps = {
  animeId: string
  episodeNumber: number
  animeResponse: IAnilistInfo
  currentEpisode?: {
    id: string
    title: string
    description: string
    number: number
    image: string
  }
  anilistId: string
  latestEpisodeNumber: number
  banner: string
  title: string
  episodeId: string
  malId: string
}

const VidstackPlayer = (props: VidstackPlayerProps) => {
  const {
    animeId,
    episodeId,
    episodeNumber,
    animeResponse,
    currentEpisode,
    anilistId,
    latestEpisodeNumber,
    banner,
    title,
    malId,
  } = props
  const { data: session } = useSession()
  const router = useRouter()
  const player = useRef<MediaPlayerInstance>(null)
  const remote = useMediaRemote(player)
  const animeVideoTitle = title
  const posterImage = banner
  const [src, setSrc] = useState<string>("")
  const setDownload = useWatchStore((store) => store.setDownload)
  const [vttUrl, setVttUrl] = useState<string>("")
  const [skipTimes, setSkipTimes] = useState<AniSkipResult[]>([])
  const [vttGenerated, setVttGenerated] = useState<boolean>(false)
  const [totalDuration, setTotalDuration] = useState<number>(0)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [textTracks, setTextTracks] = useState<ITracks[]>([])
  const [playerState, setPlayerState] = useState({
    currentTime: 0,
    isPlaying: false,
  })

  const autoSkip = useStore(
    useAutoSkip,
    (store: any) => store.autoSkip as boolean
  )
  const autoPlay = useStore(
    useAutoPlay,
    (store: any) => store.autoPlay as boolean
  )
  const autoNext = useStore(
    useAutoNext,
    (store: any) => store.autoNext as boolean
  )
  const [opButton, setOpButton] = useState(false)
  const [otButton, setEdButton] = useState(false)

  useEffect(() => {
    if (player.current && currentTime) {
      player.current.currentTime = currentTime
    }
  }, [currentTime])

  useEffect(() => {
    const updateViews = async function () {
      return await increment(animeId, latestEpisodeNumber)
    }

    updateViews()
  }, [animeId, latestEpisodeNumber])

  useEffect(() => {
    const createView = async function () {
      return await createViewCounter({
        animeId,
        title: animeResponse.title.english ?? animeResponse.title.romaji,
        image: animeResponse.image,
        latestEpisodeNumber,
        anilistId,
      })
    }

    createView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anilistId, animeId])

  async function updateWatch() {
    if (currentEpisode && animeId) {
      return await updateWatchlist({
        episodeId: `${animeId}-episode-${episodeNumber}`,
        episodeNumber: `${episodeNumber}`,
        animeId,
        image: currentEpisode?.image ?? animeResponse.image,
      })
    }
  }

  useEffect(() => {
    if (!session) return

    if (animeId && currentEpisode) {
      const createWatch = async function () {
        return await createWatchlist({
          animeId,
          episodeNumber: `${episodeNumber}`,
          title: animeResponse.title.english ?? animeResponse.title.romaji,
          image: currentEpisode?.image ?? animeResponse.image,
          anilistId,
        })
      }

      createWatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, anilistId, animeId, currentEpisode])

  useEffect(() => {
    if (autoPlay && player.current) {
      player.current
        .play()
        .catch((e) => console.log("Playback failed to start automatically:", e))
    }
  }, [autoPlay, src])

  function onProviderChange(
    provider: MediaProviderAdapter | null,
    _nativeEvent: MediaProviderChangeEvent
  ) {
    if (isHLSProvider(provider)) {
      provider.config = {}
    }
  }

  function onLoadedMetadata() {
    if (player.current) {
      setTotalDuration(player.current.duration)
    }
  }

  function onTimeUpdate() {
    if (player.current && currentEpisode) {
      const currentTime = player.current.currentTime
      const duration = player.current.duration || 1
      const playbackPercentage = (currentTime / duration) * 100
      const playbackInfo = {
        currentTime,
        playbackPercentage,
      }

      const opStart = skipTimes[0]?.interval.startTime ?? 0
      const opEnd = skipTimes[0]?.interval.endTime ?? 0

      const epStart = skipTimes[1]?.interval.startTime ?? 0
      const epEnd = skipTimes[1]?.interval.endTime ?? 0

      const opButtonText = skipTimes[0]?.skipType
      const edButtonText = skipTimes[1]?.skipType

      setOpButton(
        opButtonText === "op" && currentTime > opStart && currentTime < opEnd
      )
      setEdButton(
        edButtonText === "ed" && currentTime > epStart && currentTime < epEnd
      )

      if (autoSkip && skipTimes.length) {
        const skipInterval = skipTimes.find(
          ({ interval }) =>
            currentTime >= interval.startTime && currentTime < interval.endTime
        )
        if (skipInterval) {
          player.current.currentTime = skipInterval.interval.endTime
        }
      }
    }
  }

  const handlePlaybackEnded = function () {
    player.current?.pause()

    if (latestEpisodeNumber === episodeNumber) return

    if (autoNext) {
      router.replace(`?id=${anilistId}&slug=${animeId}&ep=${episodeNumber + 1}`)
    }
  }

  function generateWebVTTFromSkipTimes(
    skipTimes: AniSkip,
    totalDuration: number
  ): string {
    let vttString = "WEBVTT\n\n"
    let previousEndTime = 0

    const sortedSkipTimes = skipTimes.results.sort(
      (a, b) => a.interval.startTime - b.interval.startTime
    )

    sortedSkipTimes.forEach((skipTime, index) => {
      const { startTime, endTime } = skipTime.interval
      const skipType =
        skipTime.skipType.toUpperCase() === "OP" ? "Opening" : "Outro"

      if (previousEndTime < startTime) {
        vttString += `${formatTime(previousEndTime)} --> ${formatTime(startTime)}\n`
        vttString += `${animeResponse.title.english ?? animeResponse.title.romaji} / Episode ${episodeNumber}\n\n`
      }

      vttString += `${formatTime(startTime)} --> ${formatTime(endTime)}\n`
      vttString += `${skipType}\n\n`
      previousEndTime = endTime

      if (index === sortedSkipTimes.length - 1 && endTime < totalDuration) {
        vttString += `${formatTime(endTime)} --> ${formatTime(totalDuration)}\n`
        vttString += `${animeResponse.title.english ?? animeResponse.title.romaji} / Episode ${episodeNumber}\n\n`
      }
    })

    return vttString
  }

  function formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)
    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
  }

  useEffect(() => {
    setCurrentTime(parseFloat(localStorage.getItem("currentTime") || "0"))

    async function fetchAndSetAnimeSource() {
      try {
        if (currentEpisode) {
          const data: SourcesResponse =
            await fetchAnimeStreamingLinks(episodeId)

          const backupSource = data.sources.find(
            (source) => source.quality === "default"
          )

          if (backupSource) {
            setSrc(backupSource.url)
            setDownload(data.download)
          } else {
            console.error("Backup source not found")
          }
        }
      } catch (error) {
        console.error("Failed to fetch anime streaming links", error)
        const response = await fetchAnimeInfoFallback(anilistId)

        const { episodesList } = response.data

        const source = episodesList.find(
          (episode: {
            episodeId: number
            id: string
            number: number
            title: string
          }) => episode.number === episodeNumber
        )

        const videoSource = await fetchAnimeStreamingLinksFallback(source.id)

        setSrc(videoSource.sources[0].url)
        setTextTracks(videoSource.tracks)
        setDownload("")
      } finally {
        console.log("FInist")
      }
    }

    async function fetchAndProcessSkipTimes() {
      if (malId) {
        try {
          if (!malId) return

          if (currentEpisode) {
            const response = (await fetchSkipTimes({
              malId: malId.toString(),
              episodeNumber: `${episodeNumber}`,
            })) as AniSkip

            const filteredSkipTimes = response.results.filter(
              ({ skipType }) => skipType === "op" || skipType === "ed"
            )
            if (!vttGenerated) {
              const vttContent = generateWebVTTFromSkipTimes(
                { results: filteredSkipTimes },
                totalDuration
              )
              const blob = new Blob([vttContent], { type: "text/vtt" })
              const vttBlobUrl = URL.createObjectURL(blob)
              setVttUrl(vttBlobUrl)
              setSkipTimes(filteredSkipTimes)
              setVttGenerated(true)
            }
          }
        } catch (error) {
          console.error("Failed to fetch skip times", error)
        }
      }
    }

    fetchAndSetAnimeSource()
    fetchAndProcessSkipTimes()
    return () => {
      setSrc("")
      setVttUrl("")
      setPlayerState({
        currentTime: 0,
        isPlaying: false,
      })
      if (vttUrl) URL.revokeObjectURL(vttUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId, malId])

  console.log(src)

  useEffect(() => {
    return player.current!.subscribe(({ canPlay }) => {
      if (canPlay) {
        if (autoPlay) {
          if (playerState?.currentTime === 0) {
            remote.play()
          } else {
            if (playerState?.isPlaying) {
              remote.play()
            } else {
              remote.pause()
            }
          }
        } else {
          if (playerState?.isPlaying) {
            remote.play()
          } else {
            remote.pause()
          }
        }
        remote.seek(playerState?.currentTime)
      }
    })
  }, [autoPlay, playerState?.currentTime, playerState?.isPlaying, remote])

  useEffect(() => {
    const plyr = player.current

    return () => {
      if (plyr) {
        plyr.destroy()
      }
    }
  }, [episodeId])

  return (
    <MediaPlayer
      key={src}
      className="font-geist-sans player relative"
      title={animeVideoTitle}
      src={{
        src: src,
        type: "application/vnd.apple.mpegurl",
      }}
      autoplay={autoPlay}
      crossorigin="anonymous"
      playsinline
      onLoadedMetadata={onLoadedMetadata}
      onProviderChange={onProviderChange}
      onDestroy={() => updateWatch()}
      onAbort={() => updateWatch()}
      onTimeUpdate={onTimeUpdate}
      ref={player}
      aspectRatio="16/9"
      load="idle"
      posterLoad="idle"
      streamType="on-demand"
      storage="storage-key"
      keyTarget="player"
      onEnded={handlePlaybackEnded}
    >
      <MediaProvider>
        <Poster
          className="vds-poster"
          src={`${env.NEXT_PUBLIC_PROXY_URI}?url=${posterImage}`}
          alt=""
          style={{ objectFit: "cover" }}
        />
        {textTracks.length > 0 &&
          textTracks.map((track) => (
            <Track
              label={track.label}
              kind={track.kind === "thumbnails" ? "chapters" : "captions"}
              src={track.file}
              default={track.default}
              key={track.file}
            />
          ))}
        {vttUrl && (
          <Track kind="chapters" src={vttUrl} default label="Skip Times" />
        )}
      </MediaProvider>
      {opButton && (
        <Button
          onClick={() =>
            Object.assign(player.current ?? {}, {
              currentTime: skipTimes[0]?.interval.endTime ?? 0,
            })
          }
          variant="secondary"
          className="absolute bottom-[70px] right-4 z-40 rounded-md px-3 py-2 text-sm sm:bottom-[83px]"
        >
          Skip Opening
        </Button>
      )}
      {otButton && (
        <Button
          variant="secondary"
          onClick={() =>
            Object.assign(player.current ?? {}, {
              currentTime: skipTimes[1]?.interval.endTime ?? 0,
            })
          }
          className="absolute bottom-[70px] right-4 z-40 rounded-[6px] px-3 py-2 text-sm sm:bottom-[83px]"
        >
          Skip Ending
        </Button>
      )}
      <DefaultVideoLayout thumbnails={vttUrl} icons={defaultLayoutIcons} />
    </MediaPlayer>
  )
}
export default VidstackPlayer
