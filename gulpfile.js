'use strict';

var gulp = require('gulp');
var tslint = require('gulp-tslint');
var childProcess = require('child_process');
var sourcemaps = require('gulp-sourcemaps');
var del = require('del');
var karma = require('karma').server;
var coveralls = require('gulp-coveralls');
var rename = require('gulp-rename');
var uglify = require('gulp-uglify');
var wrap = require('gulp-wrap-umd');
var runSequence = require('run-sequence');
var gutil = require('gulp-util');
var notifier = require('node-notifier');
var path = require('path');

var tsConfig = require('./tsconfig.json');
var tslintConfig = require('./tslint.json');

var spawn = childProcess.spawn;
var tscPath = path.join(__dirname, 'node_modules', 'typescript', 'bin', 'tsc.js');
var mainFileName = 'prouter';
var mainFile = 'src/' + mainFileName + '.js';

var tsArr = [tscPath];

for (var prop in tsConfig.compilerOptions) {
    tsArr.push('--' + prop);
    var val = tsConfig.compilerOptions[prop];
    if (typeof val === 'string') {
        tsArr.push(val);
    }
}


var _runTask = gulp.Gulp.prototype._runTask;

gulp.Gulp.prototype._runTask = function (task) {
    this.currentTask = task;
    _runTask.call(this, task);
};

function reportError(error, taskName) {
    if (this.currentTask) {
        taskName = this.currentTask.name;
    }
    var title = "Gulp task failed '" + taskName + "'";
    var message = error.toString();
    var report = gutil.colors.red.bold(title) + gutil.colors.red(': ' + message);
    console.error(report);
    notifier.notify({
        title: title,
        message: message,
        sound: true
    });
    if (this.emit) {
        this.emit('end');
    }
}

function compileTs(srcFiles, done) {
    var self = this;
    var args = tsArr.concat(srcFiles);     
    var tsc = spawn('node', args);
    tsc.stdout.on('data', function(data) {
        reportError.call(self, data);
    });
    tsc.stderr.on('data', function(data) {
        reportError.call(self, data);
    });
    tsc.on('close', function(code) {
        done(code);
    });
}

/*** Tasks ***/

/**
 * Run tests once and exit.
 */
gulp.task('test', function (done) {
    karma.start({
        configFile: __dirname + '/karma.conf.js',
        action: 'run',
        autoWatch: false,
        singleRun: true
    }, done);
});

gulp.task('coveralls', ['test'], function () {
    return gulp.src('build/reports/coverage/**/lcov.info')
        .pipe(coveralls());
});

gulp.task('clean', function (done) {
    del(['dist/**/*', 'src/*', '!src/*.ts'], done);
});

gulp.task('script', function () {
    return gulp.src(mainFile)
        .pipe(sourcemaps.init({
        loadMaps: true
    }))
        .pipe(wrap({ namespace: 'Prouter', exports: 'Prouter' }))
        .pipe(sourcemaps.write('.'))
        .pipe(gulp.dest('dist'));
});

gulp.task('script:minify', ['script'], function () {
    return gulp.src('dist/' + mainFileName + '.js')
        .pipe(uglify())
        .on('error', reportError)
        .pipe(rename(mainFileName + '.min.js'))
        .pipe(gulp.dest('dist'));
});

gulp.task('lint', function () {
    return gulp.src(tsConfig.filesGlob)
        .pipe(tslint({ configuration: tslintConfig }))        
        .pipe(tslint.report('full'));
});

gulp.task('release', ['lint', 'script:minify', 'test']);

gulp.task('build', function (done) {
    compileTs.call(this, tsConfig.files, function() {
        runSequence('release', done);
    });    
});  

gulp.task('release:watch', ['build'], function () {
    gulp.watch([mainFile, 'test/*.spec.js'], ['release']);
});

gulp.task('dev', ['build'], function () {
    var self = this;
    gulp.watch(tsConfig.files, function(evt) {
        compileTs.call(self, evt.path, function() {
            runSequence('release');
        });
    });
});

gulp.task('default', ['release:watch']);
