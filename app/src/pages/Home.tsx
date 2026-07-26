import TopBar from '../components/app/TopBar'
import LeftPanel from '../components/app/LeftPanel'
import CanvasStage from '../components/app/CanvasStage'
import CandidateRail from '../components/app/CandidateRail'
import Composer from '../components/app/Composer'
import ChatDock from '../components/app/ChatDock'
import StarModal from '../components/app/StarModal'
import ApiSettingsModal from '../components/app/ApiSettingsModal'

export default function Home() {
  return (
    <div className="wallpaper h-screen w-screen flex flex-col overflow-hidden text-neutral-900">
      <TopBar />
      <div className="flex-1 flex min-h-0 relative px-3 pb-3 gap-0">
        <LeftPanel />
        <CanvasStage />
        <CandidateRail />
        <Composer />
        <ChatDock />
      </div>
      <StarModal />
      <ApiSettingsModal />
    </div>
  )
}
