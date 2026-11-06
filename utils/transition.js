export const fadeTransition = {
  enterActiveClass: 'transition ease-out duration-500 absolute',
  leaveActiveClass: 'transition ease-out duration-500 absolute',
  enterFromClass: 'opacity-0',
  leaveFromClass: 'opacity-100',
  enterToClass: 'opacity-100',
  leaveToClass: 'opacity-0'
}

export const slideRightTransition = {
  enterActiveClass: 'transition ease-out duration-500',
  leaveActiveClass: 'transition ease-in duration-500',
  enterFromClass: '-translate-x-full absolute opacity-0',
  leaveFromClass: 'translate-x-0 absolute opacity-100',
  enterToClass: 'translate-x-0 absolute opacity-100',
  leaveToClass: 'translate-x-full absolute opacity-0'
}

export const blurTransition = {
  enterActiveClass: 'transition ease-out duration-500',
  leaveActiveClass: 'transition ease-in duration-500',
  enterFromClass: 'opacity-0 blur',
  leaveFromClass: 'opacity-100 blur-0',
  enterToClass: 'opacity-100 blur-0',
  leaveToClass: 'opacity-0 blur'
}
