import { Intent, IResizeEntry, Position, ResizeSensor } from "@blueprintjs/core";
import { EVENTS } from "@common/constants/events";
import { StoreState } from "@common/store";
import * as actions from "@common/store/actions";
import { getUserPlaylists } from "@common/store/auth/selectors";
import { PlayerStatus } from "@common/store/player";
import { getCurrentPlaylistId } from "@common/store/player/selectors";
import { getPreviousScrollTop } from "@common/store/ui/selectors";
// eslint-disable-next-line import/no-cycle
import { ContentContext, INITIAL_LAYOUT_SETTINGS, LayoutSettings } from "@renderer/_shared/context/contentContext";
import cn from "classnames";
import { autobind } from "core-decorators";
// eslint-disable-next-line import/no-extraneous-dependencies
import { ipcRenderer } from "electron";
import * as is from "electron-is";
import { UnregisterCallback } from "history";
import { debounce } from "lodash";
import * as React from "react";
import Theme from "react-custom-properties";
import Scrollbars from "react-custom-scrollbars";
import { connect } from "react-redux";
import { RouteComponentProps, withRouter } from "react-router";
import { FixedSizeList } from "react-window";
import { bindActionCreators, compose, Dispatch } from "redux";
import ErrorBoundary from "../_shared/ErrorBoundary";
import Spinner from "../_shared/Spinner/Spinner";
import AppError from "./components/AppError/AppError";
import AboutModal from "./components/modals/AboutModal/AboutModal";
import ChangelogModal from "./components/modals/ChangeLogModal/ChangelogModal";
import Player from "./components/player/Player";
import SideBar from "./components/Sidebar/Sidebar";
import { Themes } from "./components/Theme/themes";
import { Toastr } from "./components/Toastr";

const mapStateToProps = (state: StoreState) => {
	const {
		app: { offline, loaded, loadingError },
		config,
		player,
		ui
	} = state;

	return {
		userPlayerlists: getUserPlaylists(state),
		playingTrack: player.playingTrack,
		theme: config.app.theme,
		toasts: ui.toasts,
		previousScrollTop: getPreviousScrollTop(state) || 0,
		currentPlaylistId: getCurrentPlaylistId(state),
		isActuallyPlaying: player.status === PlayerStatus.PLAYING,

		offline,
		loaded,
		loadingError
	};
};

const mapDispatchToProps = (dispatch: Dispatch) =>
	bindActionCreators(
		{
			addToast: actions.addToast,
			clearToasts: actions.clearToasts,
			initApp: actions.initApp,
			removeToast: actions.removeToast,
			setDimensions: actions.setDimensions,
			toggleOffline: actions.toggleOffline,
			setScrollPosition: actions.setScrollPosition,
			stopWatchers: actions.stopWatchers
		},
		dispatch
	);

interface State {
	isScrolling: boolean;
	settings: LayoutSettings;
	getList?(): FixedSizeList | null;
}

type PropsFromState = ReturnType<typeof mapStateToProps>;

type PropsFromDispatch = ReturnType<typeof mapDispatchToProps>;

type AllProps = PropsFromState & PropsFromDispatch & RouteComponentProps;

@autobind
class Layout extends React.Component<AllProps, State> {
	public state: State = {
		settings: INITIAL_LAYOUT_SETTINGS,
		isScrolling: false
	};

	private readonly contentRef: React.RefObject<Scrollbars> = React.createRef();
	private readonly debouncedHandleResize: (entries: IResizeEntry[]) => void;
	private readonly debouncedSetScrollPosition: (scrollTop: number, pathname: string) => any;
	private unregister?: UnregisterCallback;

	constructor(props: AllProps) {
		super(props);

		this.debouncedHandleResize = debounce(this.handleResize, 500, { leading: true });
		this.debouncedSetScrollPosition = debounce(props.setScrollPosition, 100);
	}

	public componentDidMount() {
		window.addEventListener("online", this.setOnlineStatus);
		window.addEventListener("offline", this.setOnlineStatus);

		this.handlePreviousScrollPositionOnBack();
	}

	public componentDidUpdate(prevProps: AllProps) {
		const { offline, addToast, removeToast } = this.props;

		if (offline !== prevProps.offline && offline === true) {
			addToast({
				key: "offline",
				intent: Intent.PRIMARY,
				message: "You are currently offline."
			});
		} else if (offline !== prevProps.offline && offline === false) {
			removeToast("offline");
		}
	}

	public componentWillUnmount() {
		const { stopWatchers } = this.props;
		stopWatchers();

		window.removeEventListener("online", this.setOnlineStatus);
		window.removeEventListener("offline", this.setOnlineStatus);

		if (this.unregister) {
			this.unregister();
		}
	}

	private setOnlineStatus() {
		const { toggleOffline } = this.props;

		toggleOffline(!navigator.onLine);
	}

	private handleResize([
		{
			contentRect: { width, height }
		}
	]: IResizeEntry[]) {
		const { setDimensions } = this.props;

		setDimensions({
			height,
			width
		});
	}

	private handleScroll(e: React.ChangeEvent<HTMLDivElement>) {
		const { scrollTop } = e.target;
		const { location } = this.props;
		const { getList } = this.state;

		if (getList) {
			const list = getList();

			if (list) {
				list.scrollTo(scrollTop);
			}
		}

		this.debouncedSetScrollPosition(scrollTop, location.pathname);
	}

	private handlePreviousScrollPositionOnBack() {
		const { previousScrollTop, history } = this.props;
		const { isScrolling } = this.state;

		this.unregister = history.listen((_location, action) => {
			if (!isScrolling) {
				const scrollTo = action === "POP" ? previousScrollTop : 0;

				this.setState(
					{
						isScrolling: true
					},
					() => {
						requestAnimationFrame(() => {
							// Scroll content to correct place
							if (this.contentRef.current) {
								this.contentRef.current.scrollTop(scrollTo);
							}

							this.setState({
								isScrolling: false
							});
						});
					}
				);
			}
		});
	}

	// tslint:disable-next-line: max-func-body-length
	public render() {
		const {
			// Vars
			offline,
			loaded,
			loadingError,
			playingTrack,
			children,
			theme,
			currentPlaylistId,
			isActuallyPlaying,
			// Functions
			toasts,
			clearToasts,
			userPlayerlists
		} = this.props;

		const { settings, getList } = this.state;

		return (
			<ResizeSensor onResize={this.debouncedHandleResize}>
				<Theme global properties={Themes[theme]}>
					<div
						className={cn("body auryo", {
							development: !(process.env.NODE_ENV === "production"),
							mac: is.osx(),
							playing: !!playingTrack
						})}>
						{!loaded && !offline && !loadingError ? <Spinner full /> : null}

						{loadingError ? (
							<AppError
								error={loadingError}
								reload={() => {
									ipcRenderer.send(EVENTS.APP.RELOAD);
								}}
							/>
						) : null}

						<main
							className={cn({
								playing: playingTrack
							})}>
							<SideBar
								items={userPlayerlists}
								isActuallyPlaying={isActuallyPlaying}
								currentPlaylistId={currentPlaylistId}
							/>

							<ContentContext.Provider
								value={{
									settings,
									list: getList,
									setList: getListFunc => this.setState({ getList: getListFunc }),
									applySettings: newSettings => {
										this.setState(({ settings: oldSettings }) => ({
											settings: { ...oldSettings, ...newSettings }
										}));
									}
								}}>
								<Scrollbars
									className="content"
									ref={this.contentRef}
									onScroll={this.handleScroll as any}
									renderTrackHorizontal={() => <div />}
									renderTrackVertical={props => <div {...props} className="track-vertical" />}
									renderThumbHorizontal={() => <div />}
									renderThumbVertical={props => <div {...props} className="thumb-vertical" />}>
									<Toastr position={Position.TOP_RIGHT} toasts={toasts} clearToasts={clearToasts} />

									<ErrorBoundary>{children}</ErrorBoundary>
								</Scrollbars>
							</ContentContext.Provider>

							<Player />
						</main>

						{/* Register Modals */}

						<AboutModal />
						<ChangelogModal />
					</div>
				</Theme>
			</ResizeSensor>
		);
	}
}

export default compose(
	withRouter,
	connect(
		mapStateToProps,
		mapDispatchToProps
	)
)(Layout);
