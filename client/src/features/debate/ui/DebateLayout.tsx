import TopTopicBar from "./TopTopicBar";
import DebateTimeline from "./DebateTimeline";
import DebateGraphCanvas from "./DebateGraphCanvas";
import RightSidebar from "./RightSidebar";
import PlaybackBar from "./PlaybackBar";
import NodeDetailDrawer from "./NodeDetailDrawer";
import FollowUpInput from "./FollowUpInput";

export default function DebateLayout() {
    return (
        <div className="h-screen w-full flex flex-col bg-agora-bg overflow-hidden">
            {/* Top Bar */}
            <TopTopicBar />

            {/* Main Area: 3-column */}
            <div className="flex-1 flex min-h-0">
                {/* Left: Timeline */}
                <DebateTimeline />

                {/* Center: Canvas + bottom bars, drawer anchored here */}
                <div className="flex-1 relative flex flex-col min-w-0 min-h-0 overflow-hidden">
                    <div className="flex-1 relative min-h-0">
                        <DebateGraphCanvas />
                    </div>
                    <FollowUpInput />
                    <PlaybackBar />
                    {/* Drawer is absolute within this column so it covers canvas + bottom bars */}
                    <NodeDetailDrawer />
                </div>

                {/* Right: Unified panel (Moderator / Evolution / Raw) */}
                <RightSidebar />
            </div>
        </div>
    );
}
