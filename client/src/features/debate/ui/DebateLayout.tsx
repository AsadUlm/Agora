import TopTopicBar from "./TopTopicBar";
import DebateTimeline from "./DebateTimeline";
import DebateGraphCanvas from "./DebateGraphCanvas";
import ModeratorPanel from "./ModeratorPanel";
import PlaybackBar from "./PlaybackBar";
import NodeDetailDrawer from "./NodeDetailDrawer";
import FollowUpInput from "./FollowUpInput";

export default function DebateLayout() {
    return (
        <div className="h-screen w-screen flex flex-col bg-agora-bg overflow-hidden">
            {/* Top Bar */}
            <TopTopicBar />

            {/* Main Area: 3-column */}
            <div className="flex-1 flex min-h-0 relative">
                {/* Left: Timeline */}
                <DebateTimeline />

                {/* Center: Graph Canvas */}
                <div className="flex-1 relative min-w-0 min-h-0">
                    <DebateGraphCanvas />
                    <NodeDetailDrawer />
                    <FollowUpInput />
                </div>

                {/* Right: Moderator */}
                <ModeratorPanel />
            </div>

            {/* Bottom: Playback Bar */}
            <PlaybackBar />
        </div>
    );
}
